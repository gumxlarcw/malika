'use strict';

const { sanitizeKeepInline, stripHtml, nullIfEmpty } = require('../htmlUtils');

/**
 * Extract metadata from a BPS interoperabilitas API response.
 *
 * Shape: { data: [paginationMeta, { judul_tabel, kolom{}, data[], keterangan_data, sumber, penanggung_jawab, change_log, ... } ] }
 *
 * Returns { meta, metrics } and an optional `value_codes` map for cell-level flags.
 */
function extractInteropMetadata(api, sourceId) {
  if (!api || typeof api !== 'object') return null;
  const payload = Array.isArray(api.data) && api.data.length > 1 ? api.data[1] : null;
  // Reject if no payload or if BPS returned an empty array (year with no data)
  if (!payload || Array.isArray(payload) || !payload.kolom) return null;

  const titleHtml = sanitizeKeepInline(payload.judul_tabel);
  const titleClean = stripHtml(payload.judul_tabel);

  const meta = {
    source_id: sourceId,
    source_type: 'interop',

    title_id_html: titleHtml,
    title_en_html: sanitizeKeepInline(payload.judul_tabel_en),
    title_clean: titleClean,

    subject_id: nullIfEmpty(payload.id_subject),
    subject_label: nullIfEmpty(payload.subject) || null,
    bab: nullIfEmpty(payload.bab),
    mms_subject: nullIfEmpty(payload.mms_subject),

    // Interop has no indicator-level unit — units live per-kolom.
    unit_id: null,
    unit_en: null,
    decimal_places: 2,

    // Interop also has no indicator-level definition; per-kolom definitions
    // are extracted into indicator_metric_meta below.
    definition: null,
    utility: null,
    // payload.catatan = HTML table-level footnotes (often diskrepansi statistik / metodologi notes).
    notes: sanitizeKeepInline(payload.catatan),
    interpretation: null,
    formula_html: null,
    formula_components: null,

    responsible_party: nullIfEmpty(payload.penanggung_jawab),
    source_citation_html: sanitizeKeepInline(payload.sumber),
    produced_by: null,

    // The legend dict for footnote codes (e=estimasi, r=diperbaiki, *=sementara, etc.)
    data_legend: payload.keterangan_data && typeof payload.keterangan_data === 'object'
      ? payload.keterangan_data
      : null,

    bps_table_id: extractBpsTableId(api.__source_url) || nullIfEmpty(payload.id_subject),
    bps_var_id: null,
    cutoff_date: null,
    bps_last_update: parseDate(payload.table_updated || api.last_update),
    fetched_at: new Date(),

    raw_metadata: {
      tahun_data: payload.tahun_data ?? null,
      wilayah: payload.wilayah ?? null,
      lingkup_id: payload.lingkup_id ?? null,
      lingkup_en: payload.lingkup_en ?? null,
      mms_id: payload.mms_id ?? null,
      change_log: payload.change_log ?? null,
      show_satuan: payload.show_satuan ?? null,
    },
  };

  // Metrics — one row per non-text kolom
  const kolom = payload.kolom && typeof payload.kolom === 'object' ? payload.kolom : {};
  const metrics = Object.entries(kolom).map(([colId, col]) => buildMetric(colId, col));

  // Cell-level flag map: { kode_wilayah: { metric_key: code, ... }, ... }
  const valueCodes = extractValueCodes(payload);

  return { meta, metrics, valueCodes };
}

function buildMetric(colId, col) {
  const labelId = nullIfEmpty(col.nama_variabel);
  const unitRaw = nullIfEmpty(col.satuan);
  return {
    metric_key: labelId || colId,
    bps_column_id: colId,
    metric_label_id: labelId,
    metric_label_en: nullIfEmpty(col.nama_variabel_en),
    metric_type: classifyType(col.tipe, unitRaw, labelId),
    unit_id: unitRaw,
    unit_en: nullIfEmpty(col.satuan_en),
    unit_multiplier: Number.isFinite(Number(col.unit_multiplier)) ? Number(col.unit_multiplier) : null,
    unit_multiplier_desc: nullIfEmpty(col.unit_multiplier_desc),
    decimal_places: Number.isFinite(Number(col.angka_desimal_dibelakang_koma))
      ? Number(col.angka_desimal_dibelakang_koma)
      : 0,
    definition: nullIfEmpty(stripHtml(col.metadata_konsep_definisi)),
    utility: nullIfEmpty(stripHtml(col.metadata_kegunaan)),
    notes: nullIfEmpty(stripHtml(col.metadata_keterangan_tambahan)),
    interpretation: nullIfEmpty(stripHtml(col.metadata_interpretasi)),
    formula_html: sanitizeKeepInline(col.metadata_rumus_html),
    formula_components: Array.isArray(col.metadata_rumusan) && col.metadata_rumusan.length > 0
      ? col.metadata_rumusan
      : null,
    cutoff_date: parseDate(col.tanggal_cut_off),
  };
}

/**
 * Walks the data rows extracting per-cell value_code entries that aren't null.
 * Result: Array of { kode_wilayah, metric_key, value_code, label }.
 * Caller can use this to UPDATE indikator_NNN.value_code via a JOIN-by-region path.
 */
function extractValueCodes(payload) {
  const kolom = payload.kolom || {};
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const out = [];
  for (const row of rows) {
    const kw = row?.kode_wilayah;
    const lab = row?.label_raw || row?.label;
    const vars = row?.variables || {};
    for (const [colId, cell] of Object.entries(vars)) {
      const code = cell?.value_code;
      if (code == null || code === '') continue;
      const metric_key = nullIfEmpty(kolom[colId]?.nama_variabel) || colId;
      out.push({ kode_wilayah: kw, label: lab, metric_key, value_code: String(code) });
    }
  }
  return out;
}

function classifyType(tipe, unit, label) {
  const t = String(tipe || '').toLowerCase();
  if (t === 'teks' || t === 'text') return 'text';
  const u = String(unit || '').toLowerCase();
  const l = String(label || '').toLowerCase();
  if (/persen|%/.test(u)) return 'percent';
  if (/rp|rupiah|usd|\$/.test(u)) return 'currency';
  if (/tahun|jiwa|orang|unit|kasus|kejadian/.test(u)) return 'count';
  if (/kg|ton|gram/.test(u)) return 'weight';
  if (/ha\b|hektar|m²|m2|km²/.test(u)) return 'area';
  if (/indeks/.test(u) || /indeks|ipm/.test(l)) return 'index';
  return 'numeric';
}

function extractBpsTableId(url) {
  if (!url) return null;
  const m = String(url).match(/id_tabel\/([^/]+)/);
  return m ? m[1] : null;
}

function parseDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

module.exports = { extractInteropMetadata };
