'use strict';

const { stripHtml, nullIfEmpty } = require('../htmlUtils');

/**
 * Extract metadata from a BPS exim API response (dataexim/sumber/{1|2}).
 *
 * Shape: { metadata: { source, value, netweight, kodehs, pod, ctr, tahun }, data: [...] }
 *
 * Two metrics ("value" in USD, "netweight" in KG) — fixed schema.
 */
function extractEximMetadata(api, sourceId, sourceName) {
  if (!api || typeof api !== 'object') return null;
  const meta_in = api.metadata && typeof api.metadata === 'object' ? api.metadata : {};

  const isImpor = /impor/i.test(String(sourceName || ''));
  const direction = isImpor ? 'Impor' : 'Ekspor';

  const meta = {
    source_id: sourceId,
    source_type: 'exim',

    title_id_html: sourceName || `Data ${direction} Maluku Utara`,
    title_en_html: null,
    title_clean: stripHtml(sourceName) || `Data ${direction} Maluku Utara`,

    subject_id: null,
    subject_label: 'Perdagangan Internasional dan Neraca Pembayaran',
    bab: 'Perdagangan Internasional',
    mms_subject: null,

    unit_id: null, // per-metric
    unit_en: null,
    decimal_places: 2,

    definition: nullIfEmpty(stripHtml(meta_in.kodehs))
      ? `Data ${direction} berdasarkan kode HS, pelabuhan, dan negara tujuan.`
      : null,
    utility: null,
    notes: nullIfEmpty(stripHtml(meta_in.tahun)),
    interpretation: null,
    formula_html: null,
    formula_components: null,

    responsible_party: 'BPS Provinsi Maluku Utara',
    source_citation_html: nullIfEmpty(meta_in.source),
    produced_by: null,

    data_legend: null,

    bps_table_id: null,
    bps_var_id: null,
    cutoff_date: null,
    bps_last_update: parseDate(api.last_update),
    fetched_at: new Date(),

    raw_metadata: {
      direction,
      column_descriptions: meta_in,
    },
  };

  // Two fixed metrics
  const valueDesc = stripHtml(meta_in.value) || `Nilai ${direction} dalam US Dollar ($)`;
  const netweightDesc = stripHtml(meta_in.netweight) || `Berat ${direction} dalam Kilogram (KG)`;

  const metrics = [
    {
      metric_key: 'value',
      bps_column_id: 'value',
      metric_label_id: `Nilai ${direction}`,
      metric_label_en: `${direction} Value`,
      metric_type: 'currency',
      unit_id: 'USD',
      unit_en: 'USD',
      unit_multiplier: null,
      unit_multiplier_desc: null,
      decimal_places: 2,
      definition: valueDesc,
      utility: null,
      notes: null,
      interpretation: null,
      formula_html: null,
      formula_components: null,
      cutoff_date: null,
    },
    {
      metric_key: 'netweight',
      bps_column_id: 'netweight',
      metric_label_id: `Berat ${direction}`,
      metric_label_en: `${direction} Net Weight`,
      metric_type: 'weight',
      unit_id: 'KG',
      unit_en: 'KG',
      unit_multiplier: null,
      unit_multiplier_desc: null,
      decimal_places: 0,
      definition: netweightDesc,
      utility: null,
      notes: null,
      interpretation: null,
      formula_html: null,
      formula_components: null,
      cutoff_date: null,
    },
  ];

  return { meta, metrics };
}

function parseDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

module.exports = { extractEximMetadata };
