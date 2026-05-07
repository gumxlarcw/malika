/**
 * Datasource Agent — Pipeline V2 Layer 2
 *
 * Handles statistical data discovery: intent resolution, candidate ranking,
 * data preview fetching, chart config generation.
 *
 * Replaces: stageIntent + stagePreview + chartAgent from V1 pipeline.
 * Reuses: intent.service, previewBuilder.service, chartAgent.service
 *
 * @module datasourceAgent
 */

'use strict';

const { okResult, failResult, agentStatus, agentDetail, agentThinking } = require('./agentProtocol');
const { EXIM, FEATURES } = require('../config');
const { GEO_DETECT_REGEX } = require('../../../../utils/geoAnalysis');
const logger = require('../../../../utils/logger').child({ service: 'DatasourceAgent' });

/**
 * Run the datasource agent.
 *
 * @param {import('./agentProtocol').AgentInput} input
 * @returns {Promise<import('./agentProtocol').AgentOutput>}
 */
async function run(input) {
  const startMs = Date.now();
  const timings = {};

  try {
    const { gate, norm, sse, context } = input;

    // ── Skip if gate says so ────────────────────────────────────────────
    if (gate?.skipIntent && gate?.route !== 'statistical_fast') {
      logger.info({ gateRoute: gate.route }, 'datasourceAgent: SKIPPED by gate hint');
      return okResult('datasource', { candidates: [], dataPreview: null, skipped: true }, { latencyMs: Date.now() - startMs });
    }

    // ── Intent resolution ───────────────────────────────────────────────
    agentStatus(sse, 'search', input._topicLabel ? `Mencari sumber data "${input._topicLabel}"…` : 'Mencocokkan sumber data…');

    const intentQuery = norm.dnaEnrichedQuery || norm.normalizedQuery || input.query;
    let candidates = [];
    let intentResult = null;
    let usedFastPath = false;

    const tIntent = Date.now();

    // Fast-path: gate-provided IDs
    if (gate?.route === 'statistical_fast' && gate?.fastPathIds?.length) {
      candidates = await _loadCandidatesById(gate.fastPathIds);
      if (candidates.length > 0) {
        usedFastPath = true;
      }
    }

    // Fast-path: hardcoded datasource IDs for known queries
    if (!usedFastPath) {
      const queryFastPathService = require('../../queryFastPath.service');
      const fpIds = queryFastPathService.getFastPathDatasources?.(intentQuery)
                 || queryFastPathService.getFastPathDatasources?.(norm.normalizedQuery)
                 || queryFastPathService.getFastPathDatasources?.(input.rawQuery?.toLowerCase());
      if (fpIds?.length) {
        candidates = await _loadCandidatesById(fpIds);
        if (candidates.length > 0) usedFastPath = true;
      }
    }

    // Full intent resolution (embedding + ranking)
    if (!usedFastPath) {
      const { resolveSearchIntent, buildDatasourceCandidates } = require('../../../search/intent.service');
      try {
        intentResult = await resolveSearchIntent({ q: intentQuery, context: {} });
      } catch { /* continue */ }
      try {
        candidates = await buildDatasourceCandidates({
          q: intentQuery,
          qb: intentResult?.query_builder || null,
          limit: 12,
        });
        if (!Array.isArray(candidates)) candidates = [];
      } catch { candidates = []; }
    }

    timings.intent = Date.now() - tIntent;

    // Candidate locking from previous context
    if (input._shouldPreferPrevCandidates && context.prevUiMeta?.candidates?.length > 0 && candidates.length === 0) {
      candidates = context.prevUiMeta.candidates.map(c => ({
        id: c.id, name: c.name, type: c.type, score: c.score || 80,
        bps_web_url: c.bps_web_url || null,
      }));
    }

    // Fallback: intent resolved a datasource but no candidates
    if (candidates.length === 0 && intentResult?.datasource?.source_id) {
      const loaded = await _loadCandidatesById([intentResult.datasource.source_id]);
      if (loaded.length > 0) {
        loaded[0].score = 85;
        candidates = loaded;
      }
    }

    // Emit intent thinking
    if (candidates.length > 0) {
      agentThinking(sse, {
        step: 'sources', icon: '📊',
        label: `${candidates.length} sumber data relevan`,
        detail: candidates.slice(0, 3).map(c => c.name || '').filter(Boolean).join(' · ').slice(0, 120),
        count: candidates.length,
        elapsedMs: timings.intent,
      });
    }

    agentDetail(sse, 'search', candidates.length > 0
      ? `${candidates.length} sumber data: ${(candidates[0].name || '').slice(0, 50)}`
      : 'Tidak ada sumber data cocok',
      { resultStatus: candidates.length > 0 ? 'ok' : 'warn' });

    // ── Data Preview ────────────────────────────────────────────────────
    agentStatus(sse, 'preview', input._topicLabel ? `Memuat data "${input._topicLabel}" terbaru…` : 'Memuat data tabel terbaru…');

    const tPreview = Date.now();
    const previewResult = await _fetchPreview(input, candidates, intentResult, usedFastPath);
    timings.preview = Date.now() - tPreview;

    // Emit preview thinking
    if (previewResult.dataPreview) {
      const rowCount = previewResult.dataPreview.rows?.length || 0;
      if (rowCount > 0) {
        agentThinking(sse, {
          step: 'data', icon: '📋',
          label: `${rowCount} baris data tabel dimuat`,
          detail: previewResult.dataPreview.title || 'Data statistik terbaru',
          elapsedMs: timings.preview,
        });
      }
      agentDetail(sse, 'preview',
        `${(previewResult.dataPreview.title || 'Tabel').slice(0, 60)} · ${rowCount} baris${previewResult.periodFallback ? ` (${previewResult.periodFallback.requestedYear}→${previewResult.periodFallback.actualYear})` : ''}${previewResult.dataPreviewSecondary ? ' +1 tabel' : ''}`);
    } else {
      agentDetail(sse, 'preview', 'Tidak ada data preview', { resultStatus: 'warn' });
    }

    // ── Chart Agent (fire-and-forget) ───────────────────────────────────
    let chartPromise = null;
    const { generateChartConfig, CHART_AGENT_ENABLED } = require('../chartAgent.service');
    if (CHART_AGENT_ENABLED && previewResult.dataPreview?.rows?.length > 1) {
      const tChart = Date.now();
      // Build a minimal ctx-like object for chartAgent
      const chartCtx = {
        dataPreview: previewResult.dataPreview,
        effectiveQuery: input.effectiveQuery,
        normalizedQuery: norm.normalizedQuery,
        userMessage: input.rawQuery,
        candidates,
      };
      chartPromise = generateChartConfig(chartCtx)
        .then(config => {
          timings.chartAgent = Date.now() - tChart;
          if (config?.should_render) {
            agentThinking(sse, {
              step: 'chart', icon: '📈',
              label: `Grafik ${config.chart_type} dipilih`,
              detail: config.chart_title || 'Visualisasi otomatis',
              elapsedMs: timings.chartAgent,
            });
          }
          return config;
        })
        .catch(err => {
          timings.chartAgent = Date.now() - tChart;
          logger.warn({ error: err.message }, 'Chart agent failed');
          return null;
        });
    }

    return okResult('datasource', {
      candidates,
      intentResult,
      usedFastPath,
      dataPreview: previewResult.dataPreview,
      dataPreviewSecondary: previewResult.dataPreviewSecondary,
      periodFallback: previewResult.periodFallback,
      isEximQuery: previewResult.isEximQuery,
      eximParams: previewResult.eximParams,
      chartPromise,
      _previewSourceId: previewResult._previewSourceId,
    }, { latencyMs: Date.now() - startMs, timings });
  } catch (err) {
    return failResult('datasource', err, { latencyMs: Date.now() - startMs });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function _loadCandidatesById(ids) {
  try {
    const DataSource = require('../../../../models/DataSource.model');
    const sources = await DataSource.findAll({
      where: { id: ids },
      attributes: ['id', 'name', 'description', 'type', 'aliases', 'category', 'visible', 'bps_web_url'],
    });
    return sources.map(ds => ({
      id: ds.id, name: ds.name, description: ds.description,
      type: ds.type, aliases: ds.aliases || null, category: ds.category || null, score: 100,
      bps_web_url: ds.bps_web_url || null,
    }));
  } catch { return []; }
}

/**
 * Smart column selection — reused from V1 pipeline.
 */
function _selectRelevantColumns(allCols, query, maxCols = 24) {
  if (!allCols || allCols.length <= maxCols) return allCols || [];
  const KEEP_FIRST = 2;
  const kept = allCols.slice(0, KEEP_FIRST);
  const remaining = allCols.slice(KEEP_FIRST);

  if (!query || !query.trim()) return allCols.slice(0, maxCols);

  const STOPWORDS = new Set([
    'data', 'tabel', 'angka', 'statistik', 'berapa', 'apa', 'yang', 'dan', 'atau',
    'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'tahun', 'bulan',
    'maluku', 'utara', 'malut', 'provinsi', 'kabupaten', 'kota', 'per',
    'terbaru', 'terkini', 'latest', 'terakhir', 'semua', 'seluruh',
  ]);
  const queryTokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length >= 2 && !STOPWORDS.has(w));
  if (queryTokens.length === 0) return allCols.slice(0, maxCols);

  const scored = remaining.map((col, idx) => {
    const colLower = (col || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    let score = 0;
    for (const token of queryTokens) {
      if (colLower.includes(token)) { score += 10; }
      else {
        for (const cw of colLower.split(/\s+/)) {
          if (cw.includes(token) || token.includes(cw)) { score += 5; break; }
        }
      }
    }
    if (/^\d{4}$/.test((col || '').trim())) score += 1;
    if (/total|jumlah|rata.?rata|average/i.test(col)) score += 2;
    return { col, score, originalIdx: idx };
  });
  scored.sort((a, b) => b.score - a.score || a.originalIdx - b.originalIdx);
  const selected = scored.slice(0, maxCols - KEEP_FIRST);
  selected.sort((a, b) => a.originalIdx - b.originalIdx);
  return [...kept, ...selected.map(s => s.col)];
}

/**
 * Fetch data preview — mirrors V1 stagePreview logic.
 */
async function _fetchPreview(input, candidates, intentResult, usedFastPath) {
  const { expandGeoShorthand, findNearestAvailablePeriod, getProcessedPreviewFromCache,
    getEximPreviewFromApi, getProcessedPreviewForRange, extractContextFromPrevUiMeta,
  } = require('../previewBuilder.service');
  const { detectMergeBundle, detectMonthlyBundle } = require('../mergeBundles');
  const { inferEximGroupFromQuery, extractEximQueryFacets, detectEximModeFromQuery, extractEximMonth, monthNameFromNo, isEximQuery: checkIsExim } = require('../eximHandler');
  const { extractPeriodRange } = require('../../../../utils/queryAnalysis');

  const result = {
    dataPreview: null, dataPreviewSecondary: null,
    periodFallback: null, isEximQuery: false, eximParams: null, _previewSourceId: null,
  };

  if (input.gate?.skipPreview) return result;

  let selectedSourceId = candidates?.[0]?.id || intentResult?.datasource?.source_id || null;
  if (!selectedSourceId) return result;
  result._previewSourceId = selectedSourceId;

  const effectiveQuery = input.effectiveQuery || input.rawQuery;
  const selectedSourceType = candidates?.[0]?.type || intentResult?.datasource?.type || 'dynamic';

  // Year + geo from inference
  let requestedYear = intentResult?.query_builder?.params?.year || input.norm.yearInference?.year || null;
  let requestedGeo = intentResult?.query_builder?.params?.geo || null;

  // Inherit year from previous context
  if (!requestedYear && input._shouldPreferPrevCandidates && input.context.prevUiMeta) {
    const prev = extractContextFromPrevUiMeta(input.context.prevUiMeta);
    if (prev?.year) requestedYear = prev.year;
  }

  // Extract geo from query
  if (!requestedGeo) {
    const geoMatch = effectiveQuery.toLowerCase().match(GEO_DETECT_REGEX);
    if (geoMatch) requestedGeo = geoMatch[1].replace(/\s+/g, ' ');
  }

  // Clear geo for all-region comparison
  const wantsAllRegions = /\b(semua|seluruh)\s+(kabupaten|kota|wilayah)/i.test(effectiveQuery) ||
    /\bper\s+(kabupaten|kota)/i.test(effectiveQuery) ||
    /\bbandingkan\s+(dengan\s+)?(kabupaten|kota|wilayah)/i.test(effectiveQuery);
  if (wantsAllRegions && requestedGeo) requestedGeo = null;

  // EXIM detection
  result.isEximQuery = selectedSourceType === 'exim' || checkIsExim(effectiveQuery);

  let eximGroup = null, eximFacets = {}, eximMonth = null, eximMode = null;
  if (result.isEximQuery) {
    eximMode = detectEximModeFromQuery(effectiveQuery);
    eximGroup = inferEximGroupFromQuery(effectiveQuery);
    eximFacets = extractEximQueryFacets(effectiveQuery);
    eximMonth = extractEximMonth(effectiveQuery) || intentResult?.query_builder?.params?.month || null;
    if (!eximGroup && /\b(terbanyak|tertinggi|terbesar|terendah)\b/i.test(effectiveQuery)) eximGroup = 'hs2';
    result.eximParams = { group: eximGroup, month: eximMonth, facets: eximFacets, mode: eximMode };
  }

  // Confidence gate
  const topScore = candidates?.[0]?.score || 0;
  const hasIntentDatasource = !!(intentResult?.datasource?.source_id);
  const shouldShowPreview = (topScore >= 70 || hasIntentDatasource || usedFastPath);
  if (!shouldShowPreview) return result;

  // Period range handling
  if (extractPeriodRange) {
    const periodRange = extractPeriodRange(intentResult?.query_builder);
    if (periodRange?.years?.length > 1 && getProcessedPreviewForRange) {
      const rangeData = await getProcessedPreviewForRange({
        sourceId: selectedSourceId, years: periodRange.years, geo: requestedGeo,
      });
      if (rangeData?.data?.length > 0) {
        const yearLabel = rangeData.availableYears?.length > 1
          ? `${rangeData.availableYears[0]}-${rangeData.availableYears[rangeData.availableYears.length - 1]}`
          : String(rangeData.availableYears?.[0] || periodRange.yearEnd);
        result.dataPreview = {
          title: `${rangeData.source} • ${yearLabel}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
          columns: _selectRelevantColumns(rangeData.columns || [], effectiveQuery),
          total_columns: (rangeData.columns || []).length,
          rows: rangeData.data.slice(0, 100), total_rows: rangeData.data.length,
          geo: requestedGeo, from: rangeData.from,
          periodRange: { requested: { start: periodRange.yearStart, end: periodRange.yearEnd }, available: rangeData.availableYears },
        };
        return result;
      }
      requestedYear = periodRange.yearEnd;
    }
  }

  // Single year / latest
  if (selectedSourceId && requestedYear) {
    // EXIM
    if (result.isEximQuery && getEximPreviewFromApi) {
      const eximData = await _fetchEximPreview(selectedSourceId, requestedYear, eximMonth, eximGroup, eximFacets, eximMode, effectiveQuery, monthNameFromNo, candidates);
      if (eximData.primary) { result.dataPreview = eximData.primary; result.dataPreviewSecondary = eximData.secondary; return result; }
    }

    // Non-EXIM
    if (!result.dataPreview) {
      const processed = await getProcessedPreviewFromCache({
        sourceId: selectedSourceId, year: requestedYear,
        month: intentResult?.query_builder?.params?.month || null,
        geo: requestedGeo,
      });
      if (processed?.data?.length > 0) {
        result.dataPreview = {
          title: `${processed.source} • ${requestedYear}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
          columns: _selectRelevantColumns(processed.columns || [], effectiveQuery),
          total_columns: (processed.columns || []).length,
          rows: processed.data.slice(0, 100), total_rows: processed.data.length,
          geo: requestedGeo, from: processed.from,
        };
      }
    }

    // Period fallback
    if (!result.dataPreview) {
      const nearest = await findNearestAvailablePeriod(selectedSourceId, requestedYear);
      if (nearest?.period && nearest.period !== requestedYear) {
        const fallback = await getProcessedPreviewFromCache({
          sourceId: selectedSourceId, year: nearest.period, month: null, geo: requestedGeo,
        });
        if (fallback?.data?.length > 0) {
          result.periodFallback = { requestedYear, actualYear: nearest.period, direction: nearest.direction };
          result.dataPreview = {
            title: `${fallback.source} • ${nearest.period}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: _selectRelevantColumns(fallback.columns || [], effectiveQuery),
            total_columns: (fallback.columns || []).length,
            rows: fallback.data.slice(0, 100), total_rows: fallback.data.length,
            geo: requestedGeo, from: fallback.from, periodFallback: result.periodFallback,
          };
        }
      }
    }
  } else if (selectedSourceId && !requestedYear) {
    // No year → latest available
    if (result.isEximQuery && getEximPreviewFromApi) {
      const latestExim = await findNearestAvailablePeriod(selectedSourceId, null);
      if (latestExim?.period) {
        requestedYear = latestExim.period;
        const eximData = await _fetchEximPreview(selectedSourceId, requestedYear, eximMonth, eximGroup, eximFacets, eximMode || 'ekspor', effectiveQuery, monthNameFromNo, candidates);
        if (eximData.primary) { result.dataPreview = eximData.primary; result.dataPreviewSecondary = eximData.secondary; return result; }
      }
    }

    if (!result.dataPreview) {
      const latest = await findNearestAvailablePeriod(selectedSourceId, null);
      if (latest?.period) {
        const latestData = await getProcessedPreviewFromCache({
          sourceId: selectedSourceId, year: latest.period, month: null, geo: requestedGeo,
        });
        if (latestData?.data?.length > 0) {
          requestedYear = latest.period;
          result.dataPreview = {
            title: `${latestData.source} • ${latest.period}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: _selectRelevantColumns(latestData.columns || [], effectiveQuery),
            total_columns: (latestData.columns || []).length,
            rows: latestData.data.slice(0, 100), total_rows: latestData.data.length,
            geo: requestedGeo, from: latestData.from,
          };
        }
      }
    }
  }

  // All-years for modal
  if (result.dataPreview && !result.isEximQuery && selectedSourceId) {
    try {
      const DataPeriod = require('../../../../models/DataPeriod.model');
      const periods = await DataPeriod.findAll({
        where: { source_id: selectedSourceId }, attributes: ['period_value'], raw: true,
      });
      const allYears = [...new Set(
        periods.map(p => String(p.period_value).trim())
          .filter(y => /^(19\d{2}|20\d{2}|2100)$/.test(y) || /^\d{2,3}$/.test(y))
      )].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

      if (allYears.length > 1 && getProcessedPreviewForRange) {
        const rangeData = await getProcessedPreviewForRange({
          sourceId: selectedSourceId, years: allYears, geo: requestedGeo,
        });
        if (rangeData?.data?.length > 0) {
          result.dataPreview.allRows = rangeData.data;
          result.dataPreview.allColumns = rangeData.columns;
          result.dataPreview.availableYears = rangeData.availableYears || allYears;
          result.dataPreview.defaultYear = (requestedYear && (rangeData.availableYears || allYears).includes(String(requestedYear)))
            ? String(requestedYear) : (rangeData.availableYears || allYears)[0];
          result.dataPreview.source_id = selectedSourceId;
        }
      } else {
        result.dataPreview.source_id = selectedSourceId;
        result.dataPreview.availableYears = allYears;
        result.dataPreview.defaultYear = allYears[0] || (requestedYear ? String(requestedYear) : null);
      }
    } catch (e) {
      logger.warn({ error: e.message }, 'datasourceAgent: allYears fetch failed');
    }
  }

  return result;
}

async function _fetchEximPreview(sourceId, year, eximMonth, eximGroup, eximFacets, eximMode, effectiveQuery, monthNameFromNo, candidates) {
  const { getEximPreviewFromApi } = require('../previewBuilder.service');
  const result = { primary: null, secondary: null };

  async function fetchOne(sid, mode) {
    const data = await getEximPreviewFromApi({
      sourceId: sid, year, month: eximMonth,
      group: eximGroup, codeHs: eximFacets?.code_hs || null,
      pod: eximFacets?.pod || null, ctr: eximFacets?.ctr || null, metric: null,
    });
    if (!data?.data?.length) return null;

    const groupLabel = eximGroup === 'hs2' ? ' (per Komoditas)' : eximGroup === 'ctr' ? ' (per Negara)' : eximGroup === 'pod' ? ' (per Pelabuhan)' : '';
    const monthLabel = eximMonth ? ` • ${monthNameFromNo(eximMonth)}` : '';
    const m = mode === 'impor' ? 'impor' : 'ekspor';
    const modeLabel = m === 'ekspor' ? 'Ekspor' : 'Impor';

    return {
      title: `${data.source || `${modeLabel} Maluku Utara`}${groupLabel} • ${year}${monthLabel}`,
      columns: _selectRelevantColumns(data.columns || [], effectiveQuery),
      total_columns: (data.columns || []).length,
      rows: data.data.slice(0, 100), total_rows: data.data.length,
      from: data.from, eximGroup, eximMode: m,
    };
  }

  if (eximMode === 'both') {
    const [ekspor, impor] = await Promise.all([
      fetchOne(EXIM.EKSPOR_SOURCE_ID, 'ekspor'),
      fetchOne(EXIM.IMPOR_SOURCE_ID, 'impor'),
    ]);
    result.primary = ekspor || impor;
    if (ekspor && impor) result.secondary = impor;
  } else {
    const sid = eximMode === 'impor' ? EXIM.IMPOR_SOURCE_ID : (sourceId || EXIM.EKSPOR_SOURCE_ID);
    result.primary = await fetchOne(sid, eximMode || 'ekspor');
  }

  return result;
}

module.exports = { run };
