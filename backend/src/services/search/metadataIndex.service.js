const { Op } = require('sequelize');

const DataSourceSearchTerm = require('../../models/DataSourceSearchTerm.model');
const { makeTermEntries, normalizeText } = require('./searchTermIndex.service');

function looksNumericLike(value) {
  if (value == null) return true;
  if (typeof value === 'number') return true;
  const s = String(value).trim();
  if (!s) return true;

  // Plain integers/decimals, possibly with thousand separators.
  if (/^[+-]?[\d.,]+$/.test(s)) return true;

  // Common percentage/units.
  if (/^[+-]?[\d.,]+\s*(%|persen)$/.test(s.toLowerCase())) return true;

  return false;
}

function looksLikeUrlOrCode(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return true;
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.startsWith('www.')) return true;
  if (s.startsWith('mailto:')) return true;
  // Avoid indexing very code-like strings.
  if (/^[a-z0-9_-]{1,3}\d{2,}$/i.test(s)) return true;
  return false;
}

function coerceColumnLabel(col) {
  if (!col) return null;
  if (typeof col === 'string') return col.trim() || null;
  if (typeof col === 'object') {
    const label = col.label != null ? String(col.label).trim() : '';
    const key = col.key != null ? String(col.key).trim() : '';
    return (label || key) ? (label || key) : null;
  }
  return null;
}

function extractColumnLabels(processedOrTable) {
  const cols = Array.isArray(processedOrTable?.columns) ? processedOrTable.columns : [];
  const out = [];
  for (const c of cols) {
    const label = coerceColumnLabel(c);
    if (!label) continue;
    out.push(label);
  }
  return out;
}

function extractStringValuesFromRows({ columns, data, maxRows = 2000, maxDistinct = 1200, maxLen = 80 } = {}) {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return [];

  // Build allowed keys from columns (when available).
  const colKeys = new Set();
  const cols = Array.isArray(columns) ? columns : [];
  for (const c of cols) {
    if (typeof c === 'string') continue;
    if (c && typeof c === 'object' && c.key != null) {
      const k = String(c.key).trim();
      if (k) colKeys.add(k);
    }
  }

  const seen = new Set();
  const out = [];
  const scan = rows.slice(0, Math.max(0, Number(maxRows) || 0));

  for (const r of scan) {
    if (!r || typeof r !== 'object') continue;

    const keys = colKeys.size > 0 ? Array.from(colKeys) : Object.keys(r);
    for (const key of keys) {
      if (!key) continue;

      const raw = r[key];
      if (raw == null) continue;

      if (looksNumericLike(raw)) continue;

      const s = String(raw).replace(/\s+/g, ' ').trim();
      if (!s) continue;
      if (s.length < 3) continue;
      if (s.length > maxLen) continue;
      if (looksLikeUrlOrCode(s)) continue;

      const norm = normalizeText(s);
      if (!norm || norm.length < 3) continue;
      if (seen.has(norm)) continue;

      seen.add(norm);
      out.push(s);

      if (out.length >= maxDistinct) return out;
    }
  }

  return out;
}

async function upsertTerms(entries) {
  if (!entries.length) return 0;

  await DataSourceSearchTerm.bulkCreate(entries, {
    updateOnDuplicate: ['term', 'weight'],
  });

  return entries.length;
}

async function pruneOldTermsForSourceKinds({ sourceId, keepByKind }) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return;

  const pairs = keepByKind instanceof Map ? Array.from(keepByKind.entries()) : [];
  for (const [kind, set] of pairs) {
    const keep = Array.from(set || []).filter(Boolean);
    if (keep.length === 0) continue;
    await DataSourceSearchTerm.destroy({
      where: {
        source_id: sid,
        kind,
        term_norm: { [Op.notIn]: keep },
      },
    });
  }
}

function buildKeepByKind(entries) {
  const m = new Map();
  for (const e of entries) {
    const kind = String(e.kind || '');
    const norm = String(e.term_norm || '');
    if (!kind || !norm) continue;
    if (!m.has(kind)) m.set(kind, new Set());
    m.get(kind).add(norm);
  }
  return m;
}

function buildEntriesFromTable({ sourceId, table }) {
  const columns = extractColumnLabels(table);
  const values = extractStringValuesFromRows({
    columns: Array.isArray(table?.columns) ? table.columns : [],
    data: Array.isArray(table?.data) ? table.data : [],
    maxRows: 2000,
    maxDistinct: 1200,
    maxLen: 80,
  });

  const colTerms = makeTermEntries({
    sourceId,
    terms: columns,
    kind: 'column',
    weightPhrase: 3,
    weightToken: 1,
  });

  const valueTerms = makeTermEntries({
    sourceId,
    terms: values,
    kind: 'value',
    weightPhrase: 1,
    weightToken: 1,
  });

  return [...colTerms, ...valueTerms];
}

async function syncMetadataIndexForTable({ sourceId, table, dryRun = false } = {}) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { ok: false, reason: 'invalid_source_id', inserted: 0 };
  }

  const entries = buildEntriesFromTable({ sourceId: sid, table });
  if (entries.length === 0) {
    return { ok: true, reason: 'no_terms_extracted', inserted: 0 };
  }

  if (dryRun) {
    return { ok: true, reason: 'dry_run', inserted: entries.length };
  }

  const inserted = await upsertTerms(entries);

  // Prune only our managed kinds; never touch other kinds (e.g., 'metric').
  const keepByKind = buildKeepByKind(entries);
  try {
    await pruneOldTermsForSourceKinds({ sourceId: sid, keepByKind });
  } catch {
    // best-effort
  }

  return { ok: true, reason: 'synced', inserted };
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

async function syncMetadataIndexFromProcessedCacheRow({ sourceId, processedJsonText, processedObj } = {}) {
  const tableObj = processedObj || tryParseJson(processedJsonText);
  const table = tableObj && typeof tableObj === 'object' ? tableObj : null;
  if (!table) return { ok: false, reason: 'invalid_processed_json', inserted: 0 };

  // Processed cache shape is usually { columns, data, ... }
  return syncMetadataIndexForTable({
    sourceId,
    table: {
      columns: table.columns,
      data: table.data,
    },
  });
}

module.exports = {
  syncMetadataIndexForTable,
  syncMetadataIndexFromProcessedCacheRow,
  // exported for tests
  extractColumnLabels,
  extractStringValuesFromRows,
  buildEntriesFromTable,
};
