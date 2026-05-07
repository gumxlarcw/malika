'use strict';

const { decodeEntities, sanitizeKeepInline, stripHtml, nullIfEmpty } = require('../htmlUtils');

/**
 * Extract metadata from a BPS dynamic API response (webapi.bps.go.id/v1/api/list/model/data/...).
 *
 * Shape: { var:[{label, unit, decimal, subj, def, note}], subject:[], turvar:[], last_update }
 *
 * Returns { meta, metrics } shaped for `indicator_meta` and `indicator_metric_meta` tables.
 */
function extractDynamicMetadata(api, sourceId) {
  if (!api || typeof api !== 'object') return null;
  // BPS dynamic returns var:[] when no data exists for the requested period.
  // The caller (backfill script) walks through periods to find one with data;
  // here we just reject the empty case.
  if (!Array.isArray(api.var) || api.var.length === 0) return null;
  const v = api.var[0];
  if (!v || !v.label) return null;

  const titleHtml = sanitizeKeepInline(v.label);
  const titleClean = stripHtml(v.label);

  const subject = Array.isArray(api.subject) && api.subject.length > 0 ? api.subject[0] : null;

  const meta = {
    source_id: sourceId,
    source_type: 'dynamic',

    title_id_html: titleHtml,
    title_en_html: null, // dynamic doesn't expose EN title
    title_clean: titleClean,

    subject_id: subject?.val != null ? String(subject.val) : null,
    subject_label: nullIfEmpty(subject?.label) || nullIfEmpty(v.subj),
    bab: null,
    mms_subject: null,

    unit_id: normalizeUnit(v.unit),
    unit_en: null,
    decimal_places: Number.isFinite(Number(v.decimal)) ? Number(v.decimal) : 2,

    definition: nullIfEmpty(stripHtml(v.def)),
    utility: null,
    notes: nullIfEmpty(stripHtml(v.note)),
    interpretation: null,
    formula_html: null,
    formula_components: null,

    responsible_party: null,
    source_citation_html: null,
    produced_by: null,

    data_legend: null,

    bps_table_id: null,
    bps_var_id: Number.isFinite(Number(v.val)) ? Number(v.val) : null,
    cutoff_date: null,
    bps_last_update: parseDate(api.last_update),
    fetched_at: new Date(),

    raw_metadata: {
      labelvervar: api.labelvervar ?? null,
      tahun: Array.isArray(api.tahun) ? api.tahun.map((t) => ({ val: t.val, label: t.label })) : null,
      turtahun: Array.isArray(api.turtahun) ? api.turtahun.map((t) => ({ val: t.val, label: t.label })) : null,
      related: api.related ?? null,
    },
  };

  // Metrics — for dynamic, the "metric" axis is `turvar`. Single-turvar
  // (val=0, label="Tidak ada") means there's just ONE metric named "Nilai".
  const turvar = Array.isArray(api.turvar) ? api.turvar : [];
  const isSingle = turvar.length === 1 && Number(turvar[0]?.val) === 0;

  const metrics = isSingle
    ? [makeDynamicMetric('Nilai', null, v)]
    : turvar.map((t) => makeDynamicMetric(stripHtml(t.label) || 'Nilai', String(t.val ?? ''), v));

  return { meta, metrics };
}

function makeDynamicMetric(label, bpsColumnId, v) {
  return {
    metric_key: label,
    bps_column_id: bpsColumnId,
    metric_label_id: label,
    metric_label_en: null,
    metric_type: classifyMetricType(v.unit, label),
    unit_id: normalizeUnit(v.unit),
    unit_en: null,
    unit_multiplier: null,
    unit_multiplier_desc: null,
    decimal_places: Number.isFinite(Number(v.decimal)) ? Number(v.decimal) : 0,
    definition: nullIfEmpty(stripHtml(v.def)),
    utility: null,
    notes: nullIfEmpty(stripHtml(v.note)),
    interpretation: null,
    formula_html: null,
    formula_components: null,
    cutoff_date: null,
  };
}

/**
 * "Tidak Ada Satuan", "Tidak ada satuan", "" → null (no unit).
 * Otherwise return the unit as-is (decoded).
 */
function normalizeUnit(unit) {
  const s = decodeEntities(unit);
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (/^tidak\s+ada\s+satuan$/i.test(trimmed)) return null;
  return trimmed;
}

function classifyMetricType(unit, label) {
  const u = String(unit || '').toLowerCase();
  const l = String(label || '').toLowerCase();
  if (/persen|%/.test(u) || /persen|persentase/.test(l)) return 'percent';
  if (/rp|rupiah|usd|\$/.test(u)) return 'currency';
  if (/tahun|jiwa|orang|unit|kasus|kejadian/.test(u)) return 'count';
  if (/kg|ton|gram/.test(u)) return 'weight';
  if (/ha|hektar|m²|m2|km²/.test(u)) return 'area';
  if (/indeks/.test(u) || /indeks|ipm/.test(l)) return 'index';
  return 'numeric';
}

function parseDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

module.exports = { extractDynamicMetadata };
