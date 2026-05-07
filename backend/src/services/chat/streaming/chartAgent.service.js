/**
 * Chart Agent Service — Agentic LLM Chart Configuration
 *
 * Uses OpenAI Structured Outputs (gpt-4.1) to analyze table data
 * and produce optimal chart configuration for the frontend ChatChart component.
 *
 * Pipeline position: Stage 5.5 — runs in parallel with knowledge context (Stage 6).
 * Latency: ~400-800ms. Cost: ~$0.0002/call.
 *
 * Fallback: if LLM call fails or times out, returns null and frontend uses
 * the rule-based chartDataProfiler.ts instead.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'ChartAgent' });
const { openAiStructuredOutput } = require('../../ai/openaiChat.service');

// ── Configuration ────────────────────────────────────────────────────────
const CHART_AGENT_ENABLED = process.env.CHART_AGENT_ENABLED !== 'false'; // default ON
const CHART_AGENT_MODEL = process.env.CHART_AGENT_MODEL || 'gemini-3-flash-preview';
const CHART_AGENT_TIMEOUT_MS = 6000; // 6s hard timeout (gpt-4.1 needs more time than mini)
const CHART_AGENT_RETRIES = 0;       // No retries — fallback to rule-based profiler
const CHART_AGENT_TEMPERATURE = 0;   // Deterministic output
const CHART_AGENT_MAX_SAMPLE_ROWS = 5; // Rows sent to LLM (for cost efficiency)

// ── TTL Cache ────────────────────────────────────────────────────────────
// Cache key: source_id + column signature → reuse chart config across similar queries
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_ENTRIES = 200;
const _cache = new Map();

function _cacheKey(sourceId, columns) {
  return `${sourceId || 'x'}:${(columns || []).sort().join(',')}`;
}

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

function _cacheSet(key, value) {
  // Evict oldest if at capacity
  if (_cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = _cache.keys().next().value;
    _cache.delete(oldestKey);
  }
  _cache.set(key, { value, ts: Date.now() });
}

// ── JSON Schema for Structured Output ────────────────────────────────────
// This schema is enforced by OpenAI — 100% adherence guaranteed.

const CHART_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    should_render: {
      type: 'boolean',
      description: 'Whether a chart should be rendered. False if data is unsuitable (single value, ≤2 rows, no numeric data).',
    },
    render_reason: {
      type: 'string',
      description: 'Brief explanation for the rendering decision.',
    },
    chart_type: {
      type: 'string',
      enum: ['line', 'bar', 'pie', 'area', 'stacked-bar', 'grouped-bar'],
      description: 'The recommended chart type.',
    },
    x_axis: {
      type: 'object',
      properties: {
        column: { type: 'string', description: 'Column name to use as X axis.' },
        label: { type: 'string', description: 'Display label for X axis.' },
        type: { type: 'string', enum: ['category', 'datetime', 'numeric'] },
      },
      required: ['column', 'label', 'type'],
      additionalProperties: false,
    },
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'Column name to plot as Y series.' },
          label: { type: 'string', description: 'Display name for the series.' },
          type: { type: 'string', enum: ['primary', 'secondary'] },
        },
        required: ['column', 'label', 'type'],
        additionalProperties: false,
      },
      description: 'One or more data series to plot.',
    },
    y_axis: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Display label for Y axis.' },
        format: { type: 'string', enum: ['number', 'percentage', 'currency', 'index'] },
      },
      required: ['label', 'format'],
      additionalProperties: false,
    },
    options: {
      type: 'object',
      properties: {
        stacked: { type: 'boolean' },
        show_legend: { type: 'boolean' },
        show_data_labels: { type: 'boolean' },
        orientation: { type: 'string', enum: ['horizontal', 'vertical'] },
        color_scheme: { type: 'string', enum: ['default', 'categorical', 'sequential', 'diverging'] },
      },
      required: ['stacked', 'show_legend', 'show_data_labels', 'orientation', 'color_scheme'],
      additionalProperties: false,
    },
    chart_title: {
      type: 'string',
      description: 'Concise chart title in Bahasa Indonesia.',
    },
    chart_subtitle: {
      type: ['string', 'null'],
      description: 'Optional subtitle (period, region, etc.).',
    },
    alternative: {
      anyOf: [
        {
          type: 'object',
          properties: {
            chart_type: { type: 'string', enum: ['line', 'bar', 'pie', 'area'] },
            reason: { type: 'string' },
          },
          required: ['chart_type', 'reason'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: 'Alternative chart type suggestion, or null if none.',
    },
  },
  required: [
    'should_render', 'render_reason', 'chart_type',
    'x_axis', 'series', 'y_axis', 'options',
    'chart_title', 'chart_subtitle', 'alternative',
  ],
  additionalProperties: false,
};

// ── System Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a data visualization expert for BPS (Badan Pusat Statistik) Indonesia.
Given a data table, decide the best chart type and configuration.

Decision rules:
1. Time-series data (monthly "Bulan" columns) → LINE chart
2. Time-series data (yearly, ≤8 years) → BAR chart
3. Time-series with 2-4 metrics → multi-series LINE chart
4. Geographic comparison (kabupaten/kota/wilayah) → horizontal BAR chart
5. Geographic with 2+ metrics → GROUPED-BAR chart
6. Categorical composition (≤8 categories, all non-negative) → PIE chart
7. Categorical (>8 categories) → BAR chart
8. Time × Geography × metric → multi-series LINE by geo
9. Single value or ≤2 rows → should_render=false
10. EXIM data by commodity (HS) → horizontal BAR
11. EXIM data by country → horizontal BAR

Formatting rules:
- Y-axis format: "percentage" for columns with persen/%, "index" for indeks/IHK/IHPB, "currency" for Rupiah/USD/Dollar, otherwise "number"
- chart_title: concise, in Bahasa Indonesia
- chart_subtitle: period and/or region context (e.g. "2024, Kota Ternate")
- show_legend: true when 2+ series
- show_data_labels: true only for pie charts or ≤6 data points
- orientation: "horizontal" for geographic/commodity/country comparisons, "vertical" otherwise
- stacked: true only for composition-over-time patterns (stacked-bar)
- color_scheme: "default" for most cases, "categorical" for geo/category comparisons, "sequential" for magnitude ranking, "diverging" for data with positive+negative values

Return ONLY the JSON object matching the schema.`;

// ── Column type detection (lightweight, rule-based) ──────────────────────
// Mirrors frontend chartDataProfiler.ts patterns for consistency

const TIME_PATTERNS = [/^bulan$/i, /^tahun$/i, /^month$/i, /^year$/i, /^periode?$/i, /^period$/i, /^triwulan$/i, /^quarter$/i, /^semester$/i];
const GEO_PATTERNS = [/^wilayah$/i, /^kabupaten/i, /^kota$/i, /^kab/i, /provinsi/i, /^region$/i, /^daerah$/i, /kabupaten.kota/i];
const METRIC_PATTERNS = [/^nilai$/i, /^value$/i, /^jumlah$/i, /^total$/i, /^angka$/i, /^indeks$/i, /^index$/i, /^persentase$/i, /^persen$/i, /^rasio$/i, /netweight/i, /^laju$/i, /^rate$/i];
const FILTER_PATTERNS = [/^kodehs$/i, /^hs2$/i, /^pod$/i, /^ctr$/i];

function _detectColumnType(col) {
  if (TIME_PATTERNS.some(p => p.test(col))) return 'time';
  if (GEO_PATTERNS.some(p => p.test(col))) return 'geo';
  if (METRIC_PATTERNS.some(p => p.test(col))) return 'metric';
  if (FILTER_PATTERNS.some(p => p.test(col))) return 'filter';
  return 'unknown';
}

function _detectMetricFormat(col) {
  const lc = col.toLowerCase();
  if (/persentase|persen|%/.test(lc)) return 'percentage';
  if (/indeks|index|ihk|ihpb/.test(lc)) return 'index';
  if (/rupiah|rp|usd|\$|dollar/i.test(lc)) return 'currency';
  return 'number';
}

// ── Build compact input for LLM ──────────────────────────────────────────

function _buildChartInput(ctx) {
  const preview = ctx.dataPreview;
  if (!preview || !preview.columns?.length || !preview.rows?.length) return null;

  const columns = preview.columns;
  const rows = preview.rows;

  // Column type analysis
  const columnTypes = {};
  for (const col of columns) {
    const detectedType = _detectColumnType(col);
    if (detectedType === 'metric' || detectedType === 'unknown') {
      // Check if values are actually numeric
      const sampleValues = rows.slice(0, 5).map(r => r[col]).filter(v => v !== null && v !== undefined);
      const numericCount = sampleValues.filter(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '')).length;
      if (numericCount >= sampleValues.length * 0.7 && sampleValues.length > 0) {
        columnTypes[col] = _detectMetricFormat(col);
      } else {
        columnTypes[col] = detectedType === 'metric' ? _detectMetricFormat(col) : 'category';
      }
    } else {
      columnTypes[col] = detectedType;
    }
  }

  // Sample rows (max 5 for token efficiency)
  const sampleRows = rows.slice(0, CHART_AGENT_MAX_SAMPLE_ROWS);

  return {
    user_query: (ctx.effectiveQuery || ctx.userMessage || '').slice(0, 200),
    table_title: (preview.title || '').slice(0, 200),
    columns,
    column_types: columnTypes,
    sample_rows: sampleRows,
    row_count: rows.length,
    source_type: preview.source_type || ctx.resolvedSourceType || null,
    source_id: preview.source_id || null,
    geo_context: ctx.geoContext || null,
    period_context: ctx.periodContext || null,
  };
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Generate chart configuration for the given pipeline context.
 *
 * @param {Object} ctx - Pipeline context (must have dataPreview populated)
 * @returns {Promise<Object|null>} ChartAgentOutput or null if chart should not render / LLM fails
 */
async function generateChartConfig(ctx) {
  if (!CHART_AGENT_ENABLED) {
    logger.debug('Chart agent disabled');
    return null;
  }

  // Skip for knowledge-only mode (no table data)
  if (!ctx.dataPreview || !ctx.dataPreview.columns?.length || !ctx.dataPreview.rows?.length) {
    logger.debug('No data preview — skipping chart agent');
    return null;
  }

  // Skip if too few rows
  if (ctx.dataPreview.rows.length <= 1) {
    logger.debug({ rowCount: ctx.dataPreview.rows.length }, 'Too few rows — skipping chart agent');
    return null;
  }

  // Build input
  const chartInput = _buildChartInput(ctx);
  if (!chartInput) return null;

  // Check cache
  const cacheKey = _cacheKey(chartInput.source_id, chartInput.columns);
  const cached = _cacheGet(cacheKey);
  if (cached) {
    logger.debug({ cacheKey }, 'Chart agent cache hit');
    return cached;
  }

  // Call LLM
  const t0 = Date.now();
  try {
    const apiKeyEnv = process.env.OPENAI_API_KEY_CHAT
      ? 'OPENAI_API_KEY_CHAT'
      : 'OPENAI_API_KEY_INTERPRETATION';

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(chartInput) },
    ];

    const data = await openAiStructuredOutput({
      apiKeyEnv,
      model: CHART_AGENT_MODEL,
      messages,
      temperature: CHART_AGENT_TEMPERATURE,
      schema: CHART_CONFIG_SCHEMA,
      schemaName: 'chart_config',
      purpose: 'chart_agent',
      timeoutMs: CHART_AGENT_TIMEOUT_MS,
      retries: CHART_AGENT_RETRIES,
    });

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('Chart agent returned empty content');
      return null;
    }

    const config = JSON.parse(content);
    const latencyMs = Date.now() - t0;
    logger.info({
      should_render: config.should_render,
      chart_type: config.chart_type,
      series_count: config.series?.length,
      latencyMs,
      source_id: chartInput.source_id,
    }, 'Chart agent result');

    // Validate: ensure referenced columns exist in actual data
    const validConfig = _validateConfig(config, chartInput.columns);
    if (!validConfig) {
      logger.warn({ config }, 'Chart agent produced invalid column references');
      return null;
    }

    // Cache the result
    _cacheSet(cacheKey, config);

    return config;
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logger.warn({ error: err.message, latencyMs }, 'Chart agent LLM call failed — falling back to rule-based profiler');
    return null;
  }
}

// ── Validation ───────────────────────────────────────────────────────────

/**
 * Validate that the LLM output references actual columns from the data.
 * Returns the config if valid, null if invalid.
 */
function _validateConfig(config, actualColumns) {
  if (!config || typeof config !== 'object') return null;
  if (!config.should_render) return config; // If not rendering, no column validation needed

  const colSet = new Set(actualColumns.map(c => c.toLowerCase()));

  // Validate x_axis column
  if (!config.x_axis?.column || !colSet.has(config.x_axis.column.toLowerCase())) {
    // Try case-insensitive match
    const match = actualColumns.find(c => c.toLowerCase() === (config.x_axis?.column || '').toLowerCase());
    if (match) {
      config.x_axis.column = match;
    } else {
      logger.debug({ expected: config.x_axis?.column, actual: actualColumns }, 'Invalid x_axis column');
      return null;
    }
  }

  // Validate series columns
  if (!config.series?.length) return null;
  for (const s of config.series) {
    if (!s.column || !colSet.has(s.column.toLowerCase())) {
      const match = actualColumns.find(c => c.toLowerCase() === (s.column || '').toLowerCase());
      if (match) {
        s.column = match;
      } else {
        logger.debug({ expected: s.column, actual: actualColumns }, 'Invalid series column');
        return null;
      }
    }
  }

  return config;
}

// ── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  generateChartConfig,
  CHART_AGENT_ENABLED,
  // Exposed for testing
  _buildChartInput,
  _validateConfig,
  _cacheKey,
  _cache,
};
