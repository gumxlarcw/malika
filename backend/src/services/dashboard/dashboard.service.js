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

/** Spec eligibility rule: a card needs at least two periods carrying values. */
const MIN_PERIODS_FOR_CARD = 2;

/**
 * IndicatorMetricMeta has no ordering column, only `id`. Picking "the first
 * metric" would therefore change across re-ingestion, so the preference is
 * explicit and the id is only a tie-breaker.
 */
const METRIC_TYPE_RANK = ['percent', 'index', 'count', 'numeric', 'currency', 'weight', 'area', 'text'];

function pickMetric(metricMetas) {
  if (!Array.isArray(metricMetas) || !metricMetas.length) return null;
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
  const metric = pickMetric(metricMetas);
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
    const [latest, trend] = await Promise.all([
      read.getLatest(sourceId, { metric }),
      read.getTrend(sourceId, { metric }),
    ]);
    return {
      ...base,
      periodCount,
      shape: latest ? 'province' : (trend.points.length ? 'regional' : 'dimensional'),
      latest,
      trend,
      error: false,
    };
  } catch {
    // One unreadable indicator must not blank the whole dashboard.
    return {
      ...base,
      periodCount,
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
    attributes: ['id', 'name', 'category', 'icon', 'color', 'display_order', 'visible'],
    order: [['display_order', 'ASC'], ['id', 'ASC']],
    raw: true,
  });

  const [metas, metricMetas, headlineIds] = await Promise.all([
    IndicatorMeta.findAll({ raw: true }),
    IndicatorMetricMeta.findAll({ raw: true }),
    appSettings.getJson(HEADLINE_SETTING_KEY),
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

  return { headline, categories, generatedAt: new Date().toISOString() };
}

module.exports = { pickMetric, buildCard, getSummary, HEADLINE_SETTING_KEY, MIN_PERIODS_FOR_CARD };
