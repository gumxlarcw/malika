const getSequelizeBps = require('../../config/db_bps');

function getIndicatorTableName(sourceId) {
  const idNum = Number(sourceId);
  if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('Invalid source_id');
  return `indikator_${idNum}`;
}

async function tableExists(sequelizeBps, tableName) {
  const [rows] = await sequelizeBps.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    { replacements: [tableName] }
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function getTableColumns(sequelizeBps, tableName) {
  const [rows] = await sequelizeBps.query(
    `SELECT column_name AS name
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`,
    { replacements: [tableName] }
  );
  const list = Array.isArray(rows) ? rows : [];
  return new Set(list.map((r) => String(r?.name || '').trim().toLowerCase()).filter(Boolean));
}

function monthNoToLabel(monthNo) {
  const n = Number(monthNo);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  const names = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return `[${n}] ${names[n - 1]}`;
}

function normalizeDashString(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (s === '-') return '';
  return s;
}

function parseNumericValue(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  const raw = String(input).trim();
  if (!raw || raw === '-') return null;

  // Handle common formatted numerics:
  // - "1,234.56" (commas thousands)
  // - "1.234,56" (dots thousands + comma decimal)
  // - "1234,56" (comma decimal)
  let s = raw.replace(/\s+/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Assume dot thousands and comma decimal OR vice versa; choose the last separator as decimal.
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const decimalIsComma = lastComma > lastDot;
    if (decimalIsComma) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // Likely comma decimal.
    s = s.replace(',', '.');
  } else {
    // Likely dot decimal or plain integer.
    // keep as-is
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeYear(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  // Dynamic tables often use th_id like 125 => 2025.
  if (n >= 0 && n <= 300 && s.length <= 3) return 1900 + n;

  // Interop/EXIM often uses actual year.
  if (n >= 1900 && n <= 2999) return n;

  return null;
}

/**
 * Generic read for non-EXIM indicators replicated into data_bps.indikator_<id>.
 * Produces a table-shaped response: { period, columns, data, source, last_update }.
 */
async function readGenericIndicatorFromBps({ sourceId, period, sourceName }) {
  const sequelizeBps = getSequelizeBps();
  if (!sequelizeBps) return { __disabled: true };

  const year = normalizeYear(period);
  const yearKey = year == null ? null : Number(year);

  // Static replication uses year=0 and th_id='static'.
  const isStatic = String(period || '') === 'static';
  const finalYear = isStatic ? 0 : yearKey;
  if (finalYear == null || !Number.isFinite(finalYear)) return null;

  const tableName = getIndicatorTableName(sourceId);
  const exists = await tableExists(sequelizeBps, tableName);
  if (!exists) return null;

  const cols = await getTableColumns(sequelizeBps, tableName);

  // Required columns for the replicated indicator tables.
  if (!cols.has('metric') || !cols.has('value')) return null;

  const hasYear = cols.has('year');
  const hasThId = cols.has('th_id');
  if (!hasYear && !hasThId) return null;

  const selectMonthNo = cols.has('month_no') ? 'month_no' : '0 AS month_no';
  const selectMonthName = cols.has('month_name') ? 'month_name' : "'' AS month_name";
  const selectDimKey = cols.has('dim_key') ? 'dim_key' : "'' AS dim_key";
  const selectDimValue = cols.has('dim_value') ? 'dim_value' : "'' AS dim_value";
  const selectDimHash = cols.has('dim_hash') ? 'dim_hash' : "'' AS dim_hash";
  const selectLastUpdate = cols.has('last_update')
    ? 'last_update'
    : cols.has('updated_at')
      ? 'updated_at AS last_update'
      : 'NULL AS last_update';

  const where = [hasYear ? 'year = ?' : 'th_id = ?'];
  const replacements = [hasYear ? finalYear : (isStatic ? 'static' : String(period))];

  const sql = `
    SELECT
      ${selectMonthNo},
      ${selectMonthName},
      ${selectDimKey},
      ${selectDimValue},
      ${selectDimHash},
      metric,
      value,
      ${selectLastUpdate}
    FROM \`${tableName}\`
    WHERE ${where.join(' AND ')}
    ORDER BY month_no ASC
  `;

  const [rows] = await sequelizeBps.query(sql, { replacements });
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;

  const metrics = Array.from(
    new Set(
      list
        .map((r) => String(r?.metric || '').trim())
        .filter((m) => m && m.toLowerCase() !== 'created_at' && m.toLowerCase() !== 'updated_at')
    )
  ).sort((a, b) => a.localeCompare(b));

  const hasMonthly = list.some((r) => Number(r?.month_no) >= 1);

  // If any row has a non-empty dim_key, use it as a display column.
  const dimKeySet = new Set(
    list
      .map((r) => String(r?.dim_key || '').trim())
      .map((s) => normalizeDashString(s))
      .filter(Boolean)
  );
  const dimKeyLabel = dimKeySet.size === 1 ? Array.from(dimKeySet)[0] : 'Dimensi';
  const hasDim = dimKeySet.size > 0 && list.some((r) => normalizeDashString(r?.dim_value));

  const groupKey = (r) => {
    const monthNo = Number(r?.month_no) || 0;
    const dimHash = String(r?.dim_hash || '');
    return `${monthNo}|${dimHash}`;
  };

  const grouped = new Map();
  let maxLastUpdate = null;

  for (const r of list) {
    const monthNo = Number(r?.month_no) || 0;
    const monthNameRaw = normalizeDashString(r?.month_name);
    const monthLabel = monthNo >= 1 ? (monthNoToLabel(monthNo) || monthNameRaw || String(monthNo)) : '';
    const dimValue = normalizeDashString(r?.dim_value);

    const key = groupKey(r);
    const existing = grouped.get(key) || {
      ...(hasMonthly ? { Bulan: monthLabel, month_no: monthNo } : {}),
      ...(hasMonthly && hasDim ? { [dimKeyLabel]: dimValue } : {}),
      ...(!hasMonthly ? (dimValue ? { [dimKeyLabel]: dimValue } : dimKeyLabel ? { [dimKeyLabel]: '' } : {}) : {}),
    };

    const metric = String(r?.metric || '').trim();
    if (metric) {
      const parsed = parseNumericValue(r?.value);
      // Prefer non-null numeric values when duplicates exist.
      // Some replicated indicator tables store duplicate rows per (month, metric)
      // where one row has the numeric value and another row is NULL.
      if (parsed !== null) {
        if (existing[metric] === null || existing[metric] === undefined) existing[metric] = parsed;
      } else {
        if (existing[metric] === undefined) existing[metric] = null;
      }
    }

    grouped.set(key, existing);

    const lu = r?.last_update ? new Date(r.last_update) : null;
    if (lu && !Number.isNaN(lu.getTime())) {
      if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
    }
  }

  const rowsOut = Array.from(grouped.values())
    .sort((a, b) => {
      if (hasMonthly) {
        const mc = Number(a.month_no || 0) - Number(b.month_no || 0);
        if (mc !== 0) return mc;
        if (hasDim) return String(a[dimKeyLabel] || '').localeCompare(String(b[dimKeyLabel] || ''));
        return 0;
      }
      return String(a[dimKeyLabel] || '').localeCompare(String(b[dimKeyLabel] || ''));
    })
    .map((r) => {
      const { month_no, ...rest } = r;
      return rest;
    });

  const columns = hasMonthly
    ? (hasDim ? ['Bulan', dimKeyLabel, ...metrics] : ['Bulan', ...metrics])
    : [dimKeyLabel, ...metrics];

  return {
    period: String(isStatic ? 'static' : period),
    columns,
    data: rowsOut,
    source: sourceName || 'Data Statistik',
    last_update: maxLastUpdate ? maxLastUpdate.toISOString().slice(0, 19).replace('T', ' ') : null,
    meta: { from: 'data_bps', table: tableName, year: finalYear },
  };
}

module.exports = {
  readGenericIndicatorFromBps,
  normalizeYear,
};
