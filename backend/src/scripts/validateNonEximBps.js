// Validates dynamic + interop indicator tables in data_bps.
// Checks that reads return data and that output contains no literal "-" placeholders.

require('../config/env');

const DataSource = require('../models/DataSource.model');
const getSequelizeBps = require('../config/db_bps');
const { readGenericIndicatorFromBps, normalizeYear } = require('../services/bpsRead/indicatorTableGenericRead.service');

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

async function getCandidatePeriods(sequelizeBps, tableName, cols, limit) {
  if (cols.has('year')) {
    const [rows] = await sequelizeBps.query(
      `SELECT DISTINCT year AS p
       FROM \`${tableName}\`
       WHERE year IS NOT NULL
       ORDER BY year DESC
       LIMIT ${Number(limit)}`
    );
    return (Array.isArray(rows) ? rows : []).map((r) => r?.p).filter((x) => x != null);
  }

  if (cols.has('th_id')) {
    const [rows] = await sequelizeBps.query(
      `SELECT DISTINCT th_id AS p
       FROM \`${tableName}\`
       WHERE th_id IS NOT NULL
       ORDER BY th_id DESC
       LIMIT ${Number(limit)}`
    );
    return (Array.isArray(rows) ? rows : []).map((r) => r?.p).filter((x) => x != null);
  }

  return [];
}

function findDashInPayload(payload) {
  const hits = [];
  const data = Array.isArray(payload?.data) ? payload.data : [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && v.trim() === '-') {
        hits.push({ row: i, column: k });
        if (hits.length >= 5) return hits;
      }
    }
  }
  return hits;
}

function getMetricColumns(payload) {
  const cols = Array.isArray(payload?.columns) ? payload.columns : [];
  // Generic reader uses a first column for month label.
  return cols.map(String).filter(Boolean).slice(1);
}

function computeNonNullCountsByColumn(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const counts = {};
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (v == null) continue;
      if (typeof v === 'number' && Number.isFinite(v)) {
        counts[k] = (counts[k] || 0) + 1;
        continue;
      }
      if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '-') {
        counts[k] = (counts[k] || 0) + 1;
      }
    }
  }
  return counts;
}

function findAllNullMetricColumns(payload) {
  const metricCols = getMetricColumns(payload);
  if (!metricCols.length) return [];

  const counts = computeNonNullCountsByColumn(payload);
  return metricCols.filter((c) => (counts[c] || 0) === 0);
}

async function main() {
  const sequelizeBps = getSequelizeBps();
  if (!sequelizeBps) {
    console.error('DB data_bps belum dikonfigurasi (DB_BPS_USER/DB_BPS_PASS).');
    process.exitCode = 2;
    return;
  }

  const maxSourcesRaw = process.env.VALIDATE_MAX_SOURCES;
  const maxSources = maxSourcesRaw == null || String(maxSourcesRaw).trim() === '' ? Infinity : Number(maxSourcesRaw);
  const pageSize = Number(process.env.VALIDATE_PAGE_SIZE || 200);
  const periodsPerSource = Number(process.env.VALIDATE_PERIODS_PER_SOURCE || 3);

  const results = {
    checked: 0,
    ok: 0,
    missingTable: [],
    noPeriods: [],
    empty: [],
    dash: [],
    allNullMetrics: [],
    errors: [],
  };

  let offset = 0;
  while (results.checked < maxSources) {
    const remaining = maxSources === Infinity ? pageSize : Math.max(0, Math.min(pageSize, maxSources - results.checked));
    if (remaining <= 0) break;

    const sources = await DataSource.findAll({
      where: { visible: true, status: true, type: ['dynamic', 'interop'] },
      attributes: ['id', 'name', 'type'],
      order: [['display_order', 'ASC'], ['id', 'ASC']],
      limit: remaining,
      offset,
    });

    if (!sources.length) break;
    offset += sources.length;

    for (const s of sources) {
    const id = Number(s.id);
    const type = String(s.type || '');
    const name = String(s.name || '');
    const tableName = getIndicatorTableName(id);

    results.checked++;

    try {
      const exists = await tableExists(sequelizeBps, tableName);
      if (!exists) {
        results.missingTable.push({ id, type, name, table: tableName });
        continue;
      }

      const cols = await getTableColumns(sequelizeBps, tableName);
      const periods = await getCandidatePeriods(sequelizeBps, tableName, cols, periodsPerSource);
      if (!periods.length) {
        results.noPeriods.push({ id, type, name, table: tableName });
        continue;
      }

      let anyOk = false;
      for (const p of periods) {
        // Try to normalize year-like values to avoid obviously invalid periods.
        const normalized = normalizeYear(p);
        const period = normalized != null ? normalized : p;

        const out = await readGenericIndicatorFromBps({ sourceId: id, period, sourceName: name });
        if (!out || !Array.isArray(out.data) || out.data.length === 0) {
          results.empty.push({ id, type, name, table: tableName, period: String(period) });
          continue;
        }

        const dashHits = findDashInPayload(out);
        if (dashHits.length) {
          results.dash.push({ id, type, name, table: tableName, period: String(period), hits: dashHits });
          continue;
        }

        const allNullCols = findAllNullMetricColumns(out);
        if (allNullCols.length) {
          results.allNullMetrics.push({
            id,
            type,
            name,
            table: tableName,
            period: String(period),
            columns: allNullCols,
          });
          continue;
        }

        anyOk = true;
      }

      if (anyOk) results.ok++;
      else {
        // If none of the candidate periods were OK, keep one marker.
        // (Details already added to empty/dash.)
      }
    } catch (e) {
      results.errors.push({ id, type, name, table: tableName, error: String(e?.message || e) });
    }
    }
  }

  const summarize = (label, arr) => {
    if (!arr.length) return;
    console.log(`\n${label}: ${arr.length}`);
    for (const it of arr.slice(0, 25)) {
      const extra = it.period ? ` period=${it.period}` : '';
      const err = it.error ? ` error=${it.error}` : '';
      console.log(`- [${it.type}] ${it.id} ${it.name}${extra}${err}`);
    }
    if (arr.length > 25) console.log(`- ... (${arr.length - 25} more)`);
  };

  console.log(`Checked ${results.checked} sources (dynamic+interop). OK: ${results.ok}`);
  summarize('Missing indicator table', results.missingTable);
  summarize('No periods found', results.noPeriods);
  summarize('Empty result for candidate periods', results.empty);
  summarize('Dash ("-") found in output', results.dash);
  summarize('All-null metric columns (suspicious)', results.allNullMetrics);
  summarize('Errors', results.errors);

  // Non-zero exit if any hard failures.
  if (
    results.missingTable.length ||
    results.noPeriods.length ||
    results.empty.length ||
    results.dash.length ||
    results.allNullMetrics.length ||
    results.errors.length
  ) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const sequelizeBps = getSequelizeBps();
      if (sequelizeBps?.close) await sequelizeBps.close();
    } catch {
      // ignore
    }
  });
