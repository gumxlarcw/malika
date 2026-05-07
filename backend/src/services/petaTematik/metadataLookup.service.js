'use strict';

/**
 * Read-side lookups against `indicator_meta` + `indicator_metric_meta` (in
 * primary DB project_data_strategis). All lookups are cached via the existing
 * petaTematik cache (LRU, 1h TTL) since metadata changes infrequently.
 *
 * Naming: `getIndikatorMeta(sourceId)` returns the indicator-level row;
 * `getMetricsMeta(sourceId)` returns all metric rows for that source;
 * `resolveMeta(sourceId, metricKey)` returns the merged view used at
 * data-render time — per-metric values override indicator-level fallbacks.
 */

const sequelize = require('../../config/db');
const { QueryTypes } = require('sequelize');
const cache = require('./cache.service');

/** Single indicator_meta row, or null if backfill missed/failed for this source. */
async function getIndikatorMeta(sourceId) {
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return cache.getOrCompute(`meta:ind:${id}`, async () => {
    const rows = await sequelize.query(
      `SELECT * FROM indicator_meta WHERE source_id = :id LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    return rows[0] || null;
  });
}

/** All metric_meta rows for a source. Empty array if none. */
async function getMetricsMeta(sourceId) {
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0) return [];
  return cache.getOrCompute(`meta:metrics:${id}`, async () => {
    return sequelize.query(
      `SELECT * FROM indicator_metric_meta WHERE source_id = :id ORDER BY id`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
  });
}

/**
 * Bulk lookup: { source_id → indicator_meta row } for an array of IDs.
 * One round-trip — used by getIndikatorList enrichment so we don't N+1 query.
 */
async function getIndikatorMetaBulk(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return new Map();
  const ids = sourceIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return new Map();

  const rows = await sequelize.query(
    `SELECT source_id, source_type, title_clean, unit_id, decimal_places,
            subject_label, bab, responsible_party
       FROM indicator_meta WHERE source_id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  const m = new Map();
  for (const r of rows) m.set(r.source_id, r);
  return m;
}

/**
 * Resolve the effective meta for a given (source, metric) — used by getData.
 * Per-metric fields take precedence over indicator-level fallbacks. The result
 * is the canonical "this is what to show in the UI" object.
 */
async function resolveMeta(sourceId, metricKey) {
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const ind = await getIndikatorMeta(id);
  if (!ind) return null;

  let metric = null;
  if (metricKey) {
    const metrics = await getMetricsMeta(id);
    metric = metrics.find((m) => m.metric_key === metricKey)
      || metrics.find((m) => (m.metric_label_id || '').toLowerCase() === String(metricKey).toLowerCase())
      || null;
  }

  // Effective unit: metric override → indicator-level → null
  const unit = metric?.unit_id ?? ind.unit_id ?? null;
  const decimal = metric?.decimal_places ?? ind.decimal_places ?? 2;
  const unit_multiplier = metric?.unit_multiplier ?? null;
  const unit_multiplier_desc = metric?.unit_multiplier_desc ?? null;

  return {
    source_id: ind.source_id,
    source_type: ind.source_type,
    title_id_html: ind.title_id_html,
    title_clean: ind.title_clean,
    subject_label: ind.subject_label,
    bab: ind.bab,
    responsible_party: ind.responsible_party,
    source_citation_html: ind.source_citation_html,
    bps_last_update: ind.bps_last_update,
    bps_table_id: ind.bps_table_id,

    unit,
    unit_multiplier,
    unit_multiplier_desc,
    decimal_places: decimal,

    // Footnote legend so frontend can render flag explanations
    data_legend: parseJson(ind.data_legend),

    // Active metric details (when metricKey provided)
    metric: metric
      ? {
          metric_key: metric.metric_key,
          label_id: metric.metric_label_id,
          label_en: metric.metric_label_en,
          metric_type: metric.metric_type,
          definition: metric.definition,
          notes: metric.notes,
          formula_html: metric.formula_html,
        }
      : null,
  };
}

/** Full rich metadata payload for the new /indikator-meta/:id endpoint. */
async function getFullMeta(sourceId) {
  const ind = await getIndikatorMeta(sourceId);
  if (!ind) return null;
  const metrics = await getMetricsMeta(sourceId);
  return {
    ...ind,
    data_legend: parseJson(ind.data_legend),
    formula_components: parseJson(ind.formula_components),
    produced_by: parseJson(ind.produced_by),
    raw_metadata: parseJson(ind.raw_metadata),
    metrics: metrics.map((m) => ({
      ...m,
      formula_components: parseJson(m.formula_components),
    })),
  };
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/**
 * Semantic search across `indicator_meta` using vector cosine similarity.
 * Embeds the query, loads all stored embeddings, computes scores in-memory.
 * For 302 rows × 768-dim, this is sub-50ms — no vector DB needed.
 */
async function semanticSearchIndikator({ query, limit = 10, type = null, minScore = 0 }) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Empty query');
  }
  const { generateEmbedding, cosineSimilarity } = require('../bpsMetadata/embedding.service');

  const queryVec = await generateEmbedding(query);

  const where = ['embedding IS NOT NULL'];
  const replacements = {};
  if (type) {
    where.push('source_type = :type');
    replacements.type = type;
  }
  const rows = await sequelize.query(
    `SELECT source_id, source_type, title_clean, unit_id, subject_label, embedding
     FROM indicator_meta
     WHERE ${where.join(' AND ')}`,
    { replacements, type: QueryTypes.SELECT },
  );

  const scored = [];
  for (const r of rows) {
    let vec;
    try {
      vec = JSON.parse(r.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVec, vec);
    if (score >= minScore) {
      scored.push({
        source_id: r.source_id,
        source_type: r.source_type,
        title: r.title_clean,
        unit: r.unit_id,
        subject: r.subject_label,
        score: Number(score.toFixed(4)),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(50, limit)));
}

module.exports = {
  getIndikatorMeta,
  getMetricsMeta,
  getIndikatorMetaBulk,
  resolveMeta,
  getFullMeta,
  semanticSearchIndikator,
};
