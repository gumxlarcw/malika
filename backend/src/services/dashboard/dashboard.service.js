'use strict';

/**
 * Catalog-driven dashboard assembly.
 *
 * Nothing here is hardcoded per indicator: the card list comes from
 * `data_sources` (which already carries category/icon/color/display_order),
 * labels and units come from IndicatorMeta / IndicatorMetricMeta, and values
 * come from services/indicator. Adding an indicator to the catalog makes it
 * appear with no code change.
 */

const DataSource = require('../../models/DataSource.model');
const IndicatorMeta = require('../../models/IndicatorMeta.model');
const IndicatorMetricMeta = require('../../models/IndicatorMetricMeta.model');
const appSettings = require('../settings/appSettings.service');
const read = require('../indicator/read.service');

const HEADLINE_SETTING_KEY = 'dashboard:headline';
const CATEGORY_ORDER_SETTING_KEY = 'dashboard:categoryOrder';

/** Spec eligibility rule: a card needs at least two periods carrying values. */
const MIN_PERIODS_FOR_CARD = 2;

/**
 * IndicatorMetricMeta has no ordering column, only `id`. Picking "the first
 * metric" would therefore change across re-ingestion, so the preference is
 * explicit and the id is only a tie-breaker.
 */
const METRIC_TYPE_RANK = ['percent', 'index', 'count', 'numeric', 'currency', 'weight', 'area', 'text'];

/** `chart_config` is stored as a JSON string on data_sources. */
function parseChartConfig(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function pickMetric(metricMetas, chartConfig) {
  if (!Array.isArray(metricMetas) || !metricMetas.length) return null;

  // A curated default wins over any heuristic. The spec reserved this hook
  // precisely because metric_type ranking cannot know which of several measures
  // an indicator is normally reported by.
  const preferred = chartConfig && typeof chartConfig.default_metric === 'string'
    ? chartConfig.default_metric
    : null;
  if (preferred && metricMetas.some((m) => m.metric_key === preferred)) return preferred;

  const ranked = [...metricMetas].sort((a, b) => {
    const ra = METRIC_TYPE_RANK.indexOf(a.metric_type);
    const rb = METRIC_TYPE_RANK.indexOf(b.metric_type);
    const na = ra === -1 ? METRIC_TYPE_RANK.length : ra;
    const nb = rb === -1 ? METRIC_TYPE_RANK.length : rb;
    if (na !== nb) return na - nb;
    return Number(a.id) - Number(b.id);
  });
  return ranked[0].metric_key || null;
}

function buildIndexes(metas, metricMetas) {
  const metaBySource = new Map();
  for (const m of metas) metaBySource.set(Number(m.source_id), m);

  const metricsBySource = new Map();
  for (const mm of metricMetas) {
    const k = Number(mm.source_id);
    if (!metricsBySource.has(k)) metricsBySource.set(k, []);
    metricsBySource.get(k).push(mm);
  }
  return { metaBySource, metricsBySource };
}

async function buildCard(source, meta, metricMetas) {
  const sourceId = Number(source.id);
  const chartConfig = parseChartConfig(source.chart_config);
  const metric = pickMetric(metricMetas, chartConfig);
  const metricMeta = (metricMetas || []).find((m) => m.metric_key === metric) || null;

  const base = {
    sourceId,
    name: (meta && meta.title_clean) || source.name,
    category: (source.category || '').trim() || 'Lainnya',
    icon: source.icon || null,
    color: source.color || null,
    metric,
    unit: (metricMeta && metricMeta.unit_id) || (meta && meta.unit_id) || null,
    // Raw value + multiplier: formatting happens once, in the frontend helper.
    unitMultiplier: (metricMeta && metricMeta.unit_multiplier) || null,
    decimalPlaces: meta && meta.decimal_places != null ? Number(meta.decimal_places) : null,
    // When an indicator reports several measures, the card must say which one it
    // is showing. "Inflasi" alone over a month-to-month figure reads as the
    // headline year-on-year rate, which it is not.
    metricLabel:
      (metricMetas || []).length > 1
        ? (metricMeta && (metricMeta.metric_label_id || metricMeta.metric_key)) || metric
        : null,
  };

  // Fetched separately from latest/trend: a failing trend query must not zero the
  // period count and silently drop an otherwise-valid indicator from the page.
  let periodCount = 0;
  try {
    periodCount = await read.getPeriodCount(sourceId, { metric });
  } catch {
    periodCount = 0;
  }

  try {
    const [latest, trend, profile] = await Promise.all([
      read.getLatest(sourceId, { metric }),
      read.getTrend(sourceId, { metric }),
      read.getDimensionProfile(sourceId, { metric }),
    ]);
    // Shape comes from the dimension profile, not from trend.points: those hold
    // province points only, so a region-only indicator would otherwise be
    // indistinguishable from a non-geographic one and lose its map affordance.
    return {
      ...base,
      periodCount,
      dimKey: profile.dimKey,
      shape: latest ? 'province' : (profile.hasRegion ? 'regional' : 'dimensional'),
      latest,
      trend,
      error: false,
    };
  } catch {
    // One unreadable indicator must not blank the whole dashboard.
    return {
      ...base,
      periodCount,
      dimKey: null,
      shape: 'dimensional',
      latest: null,
      trend: { points: [], delta: null },
      error: true,
    };
  }
}

async function getSummary() {
  const sources = await DataSource.findAll({
    where: { visible: true },
    attributes: ['id', 'name', 'category', 'icon', 'color', 'display_order', 'visible', 'chart_config'],
    order: [['display_order', 'ASC'], ['id', 'ASC']],
    raw: true,
  });

  const [metas, metricMetas, headlineIds, categoryOrder] = await Promise.all([
    IndicatorMeta.findAll({ raw: true }),
    IndicatorMetricMeta.findAll({ raw: true }),
    appSettings.getJson(HEADLINE_SETTING_KEY),
    appSettings.getJson(CATEGORY_ORDER_SETTING_KEY),
  ]);

  const { metaBySource, metricsBySource } = buildIndexes(metas || [], metricMetas || []);

  const cards = await Promise.all(
    sources.map((s) => buildCard(s, metaBySource.get(Number(s.id)) || null, metricsBySource.get(Number(s.id)) || []))
  );

  // Spec: an indicator with fewer than two periods carrying non-null values is
  // not eligible for a card; it stays discoverable via /kategori.
  const eligible = cards.filter((c) => c.periodCount >= MIN_PERIODS_FOR_CARD);

  const byId = new Map(eligible.map((c) => [c.sourceId, c]));
  const headline = Array.isArray(headlineIds)
    ? headlineIds.map((id) => byId.get(Number(id))).filter(Boolean)
    : eligible.filter((c) => c.shape === 'province').slice(0, 6);

  const categories = [];
  const seen = new Map();
  for (const card of eligible) {
    if (!seen.has(card.category)) {
      seen.set(card.category, { name: card.category, indicators: [] });
      categories.push(seen.get(card.category));
    }
    seen.get(card.category).indicators.push(card);
  }

  // Categories the saved order does not mention keep their existing position at
  // the end, so a stale order can never hide a newly added category.
  if (Array.isArray(categoryOrder) && categoryOrder.length) {
    const rank = new Map(categoryOrder.map((name, i) => [String(name), i]));
    categories.sort((a, b) => {
      const ra = rank.has(a.name) ? rank.get(a.name) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.name) ? rank.get(b.name) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }

  return { headline, categories, generatedAt: new Date().toISOString() };
}

/**
 * Longer series for a handful of named indicators.
 *
 * getSummary caps every trend at the card default, which is enough for a
 * sparkline and not enough for a twelve-month panel. Rather than deepen every
 * one of ~285 trends to serve a few panels, callers name the indicators they
 * need and how far back. Reads go through read.getTrend, so they share the same
 * watermark-keyed cache as the summary and cost nothing extra when warm.
 */

const MAX_SERIES_IDS = 8;
const MAX_SERIES_POINTS = 40;
const DEFAULT_SERIES_POINTS = 12;

function normaliseSeriesIds(raw) {
  const list = String(raw == null ? '' : raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) throw new Error('Invalid ids');
  if (list.length > MAX_SERIES_IDS) throw new Error('Invalid ids');
  for (const v of list) if (!/^\d+$/.test(v)) throw new Error('Invalid ids');
  return [...new Set(list.map(Number))];
}

function normaliseSeriesLimit(raw) {
  if (raw == null || raw === '') return DEFAULT_SERIES_POINTS;
  if (!/^\d+$/.test(String(raw))) throw new Error('Invalid limit');
  const n = Number(raw);
  if (n < 2 || n > MAX_SERIES_POINTS) throw new Error('Invalid limit');
  return n;
}

async function getSeries(idsInput, limitInput) {
  const ids = normaliseSeriesIds(idsInput);
  const limit = normaliseSeriesLimit(limitInput);

  const sources = await DataSource.findAll({
    where: { id: ids, visible: true },
    attributes: ['id', 'name', 'chart_config'],
    raw: true,
  });
  if (!sources.length) return { series: [] };

  const presentIds = sources.map((s) => Number(s.id));
  const [metas, metricMetas] = await Promise.all([
    IndicatorMeta.findAll({ where: { source_id: presentIds }, raw: true }),
    IndicatorMetricMeta.findAll({ where: { source_id: presentIds }, raw: true }),
  ]);
  const { metaBySource, metricsBySource } = buildIndexes(metas || [], metricMetas || []);
  const bySource = new Map(sources.map((s) => [Number(s.id), s]));

  // Requested order is preserved so callers can align series into rows without
  // matching on id; ids that resolve to nothing visible are simply absent.
  const series = await Promise.all(
    ids
      .filter((id) => bySource.has(id))
      .map(async (id) => {
        const source = bySource.get(id);
        const meta = metaBySource.get(id) || null;
        const mm = metricsBySource.get(id) || [];
        const metric = pickMetric(mm, parseChartConfig(source.chart_config));
        const metricMeta = mm.find((m) => m.metric_key === metric) || null;

        let trend = { points: [], delta: null };
        try {
          trend = await read.getTrend(id, { metric, limit });
        } catch {
          // One unreadable indicator must not blank the whole panel.
        }

        return {
          sourceId: id,
          name: (meta && meta.title_clean) || source.name,
          metric,
          unit: (metricMeta && metricMeta.unit_id) || (meta && meta.unit_id) || null,
          decimalPlaces: meta && meta.decimal_places != null ? Number(meta.decimal_places) : null,
          points: trend.points,
          delta: trend.delta,
        };
      })
  );

  return { series };
}

module.exports = {
  pickMetric,
  buildCard,
  getSummary,
  getSeries,
  HEADLINE_SETTING_KEY,
  CATEGORY_ORDER_SETTING_KEY,
  MIN_PERIODS_FOR_CARD,
  MAX_SERIES_IDS,
  MAX_SERIES_POINTS,
  DEFAULT_SERIES_POINTS,
};
