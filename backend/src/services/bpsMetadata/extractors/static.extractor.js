'use strict';

const { decodeEntities, stripHtml, sanitizeKeepInline, nullIfEmpty } = require('../htmlUtils');

/**
 * Extract metadata from a BPS statictable API response.
 *
 * Shape: { data: { table_id, sub_id, subcsa, title, table (HTML), excel, size, related, cr_date, updt_date } }
 *
 * Returns { meta, metrics, staticTable } where staticTable is shaped for
 * the indicator_static_table row (HTML + parsed JSON).
 */
function extractStaticMetadata(api, sourceId) {
  if (!api || typeof api !== 'object') return null;
  const payload = api.data && typeof api.data === 'object' ? api.data : null;
  if (!payload) return null;

  const titleClean = stripHtml(payload.title) || `Tabel statis ${sourceId}`;

  const meta = {
    source_id: sourceId,
    source_type: 'static',

    title_id_html: sanitizeKeepInline(payload.title),
    title_en_html: null,
    title_clean: titleClean,

    subject_id: payload.subcsa_id != null ? String(payload.subcsa_id) : null,
    subject_label: nullIfEmpty(payload.subcsa),
    bab: null,
    mms_subject: null,

    unit_id: null,
    unit_en: null,
    decimal_places: 0,

    definition: null,
    utility: null,
    notes: null,
    interpretation: null,
    formula_html: null,
    formula_components: null,

    responsible_party: 'BPS Provinsi Maluku Utara',
    source_citation_html: null,
    produced_by: null,

    data_legend: null,

    bps_table_id: payload.table_id != null ? String(payload.table_id) : null,
    bps_var_id: null,
    cutoff_date: null,
    bps_last_update: parseDate(payload.updt_date || payload.cr_date),
    fetched_at: new Date(),

    raw_metadata: {
      sub_id: payload.sub_id ?? null,
      subcsa_id: payload.subcsa_id ?? null,
      cr_date: payload.cr_date ?? null,
      updt_date: payload.updt_date ?? null,
      excel: payload.excel ?? null,
      size: payload.size ?? null,
      related: Array.isArray(payload.related) ? payload.related : null,
    },
  };

  // Parse the HTML table to a structured JSON {columns:[], rows:[[]]}
  const decodedHtml = decodeEntities(payload.table) || '';
  const parsed = parseHtmlTable(decodedHtml);

  // Metrics — for static, derive from parsed columns. Values are usually text;
  // mark each as 'text' type. Skip the first column (assumed to be region label).
  const metrics = (parsed?.columns || []).slice(1).map((col, idx) => ({
    metric_key: stripHtml(col) || `col_${idx + 1}`,
    bps_column_id: `col_${idx + 1}`,
    metric_label_id: stripHtml(col) || `Kolom ${idx + 1}`,
    metric_label_en: null,
    metric_type: 'text',
    unit_id: null,
    unit_en: null,
    unit_multiplier: null,
    unit_multiplier_desc: null,
    decimal_places: 0,
    definition: null,
    utility: null,
    notes: null,
    interpretation: null,
    formula_html: null,
    formula_components: null,
    cutoff_date: null,
  }));

  const staticTable = {
    source_id: sourceId,
    table_html: decodedHtml,
    table_parsed: parsed,
    excel_url: nullIfEmpty(payload.excel),
    size_label: nullIfEmpty(payload.size),
    cr_date: parseDate(payload.cr_date),
    updt_date: parseDate(payload.updt_date),
    related: Array.isArray(payload.related) ? payload.related : null,
    fetched_at: new Date(),
  };

  return { meta, metrics, staticTable };
}

/**
 * Parse a `<table>` HTML string to { columns: string[], rows: string[][] }.
 * Lightweight regex-based parsing — sufficient for BPS's well-formed static tables.
 */
function parseHtmlTable(html) {
  if (!html) return null;

  // Extract just the <table>...</table> block
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const tableBlock = tableMatch[0];

  // Header row from <thead>...<tr>...<th>...</th>... or first <tr> with <th>
  let columns = [];
  const theadMatch = tableBlock.match(/<thead[\s\S]*?<\/thead>/i);
  const headSearch = theadMatch ? theadMatch[0] : tableBlock;
  const headRowMatch = headSearch.match(/<tr[\s\S]*?<\/tr>/i);
  if (headRowMatch) {
    const cells = headRowMatch[0].match(/<th[^>]*>([\s\S]*?)<\/th>/gi);
    if (cells) columns = cells.map((c) => stripCellHtml(c));
  }

  // Body rows
  const bodyMatch = tableBlock.match(/<tbody[\s\S]*?<\/tbody>/i);
  const rowsBlock = bodyMatch ? bodyMatch[0] : tableBlock;
  const trMatches = rowsBlock.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const rows = [];
  for (const tr of trMatches) {
    if (/<th\b/i.test(tr) && rows.length === 0 && columns.length > 0) continue;
    const tds = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (tds) rows.push(tds.map((c) => stripCellHtml(c)));
  }

  return { columns, rows };
}

function stripCellHtml(cell) {
  return stripHtml(cell.replace(/^<[^>]*>|<\/[^>]*>$/g, '')) ?? '';
}

function parseDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

module.exports = { extractStaticMetadata };
