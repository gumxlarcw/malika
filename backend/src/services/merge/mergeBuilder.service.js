const { fetchAvailablePeriodsForSource } = require('../period/fetchAvailable.service');
const { fetchRawByTh } = require('../period/fetchByTh.service');
const processDynamic = require('../processor/dynamic.processor');

const MONTH_ORDER = [
  'Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'
];

function getPeriodOrder(name) {
  const s = String(name || '').trim();
  if (!s) return null;

  // Supports patterns like "[1] Januari".
  const m = s.match(/\[(\d{1,2})\]/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 35) return n;
  }

  // Monthly names
  const idx = MONTH_ORDER.indexOf(s);
  if (idx >= 0) return idx + 1;

  // Quarterly labels (Triwulan I-IV) and Tahunan
  // Boundary-aware so "Triwulan IV" doesn't match "Triwulan I".
  if (/triwulan\s+iv\b/i.test(s)) return 34;
  if (/triwulan\s+iii\b/i.test(s)) return 33;
  if (/triwulan\s+ii\b/i.test(s)) return 32;
  if (/triwulan\s+i\b/i.test(s)) return 31;
  if (/tahunan\b/i.test(s)) return 35;

  return null;
}

async function buildMergedProcessed({ sourceId, datasource, thIds, useAll }) {
  const thIdsParam = (thIds || []).map((x) => String(x).trim()).filter(Boolean);

  let resolvedThIds = thIdsParam;
  const periods = await fetchAvailablePeriodsForSource(sourceId);

  if (!resolvedThIds.length && useAll) {
    resolvedThIds = periods.map((p) => String(p.th_id));
  }
  if (!resolvedThIds.length) {
    const err = new Error('th_ids is required or use all=true');
    err.status = 400;
    throw err;
  }

  const processedList = [];
  for (const thId of resolvedThIds) {
    const raw = await fetchRawByTh(sourceId, thId);
    const processed = processDynamic(raw);
    processedList.push({ th_id: String(thId), processed });
  }

  const sourceMeta = datasource?.name ? { id: sourceId, name: datasource.name } : { id: sourceId };

  let lastUpdate = new Date(0);
  const rows = [];
  for (const item of processedList) {
    const p = item.processed;
    if (p?.data) {
      p.data.forEach((row) => rows.push({ ...row, th_id: item.th_id }));
    }
    const lu = p?.last_update ? new Date(p.last_update) : new Date(0);
    if (lu > lastUpdate) lastUpdate = lu;
  }

  const metricCandidates = new Set();
  const numericKeys = new Set();
  for (const r of rows) {
    Object.keys(r || {}).forEach((k) => {
      if (k === 'Bulan' || k === 'th_id') return;
      metricCandidates.add(k);
      const v = r?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) numericKeys.add(k);
    });
  }
  // Only treat keys as metrics when they contain numeric values.
  // This avoids including string dimensions like "Wilayah" in metrics.
  const metrics = Array.from(metricCandidates).filter((k) => numericKeys.has(k));

  // Preserve non-metric string dimensions (e.g., "Wilayah") so replication can store them
  // into dim_key/dim_value and avoid collapsing multiple rows into one.
  const dimensionKeys = Array.from(metricCandidates)
    .filter((k) => !metrics.includes(k))
    .filter((k) => rows.some((r) => typeof r?.[k] === 'string' && String(r[k]).trim()));

  const thToYear = new Map(periods.map((p) => [String(p.th_id), p.year]));

  const yearGroups = new Map();
  for (const r of rows) {
    const th = String(r.th_id);
    const year = thToYear.get(th) || th;
    if (!yearGroups.has(year)) yearGroups.set(year, []);
    yearGroups.get(year).push(r);
  }

  const years = Array.from(yearGroups.entries())
    .map(([year, items]) => {
      const thIdForYear = String((periods.find((p) => p.year === year) || {}).th_id || '');
      return {
        year,
        th_id: thIdForYear,
        months: items.map((it) => ({
          name: it.Bulan,
          values: metrics.reduce((acc, m) => {
            acc[m] = it[m] ?? null;
            return acc;
          }, {}),
          dims: dimensionKeys.reduce((acc, k) => {
            acc[k] = it?.[k] ?? '';
            return acc;
          }, {}),
        })),
      };
    })
    .sort((a, b) => String(a.year).localeCompare(String(b.year)));

  const tableColumns = [
    { key: 'year', label: 'Tahun' },
    { key: 'month', label: 'Bulan' },
    ...dimensionKeys.map((k) => ({ key: k, label: k })),
    ...metrics.map((m) => ({ key: m, label: m })),
  ];

  const tableRows = years.flatMap((y) =>
    y.months.map((m) => ({
      year: y.year,
      month: m.name,
      ...(m.dims || {}),
      ...m.values,
      th_id: y.th_id,
    }))
  );

  tableRows.sort((a, b) => {
    const yc = String(a.year).localeCompare(String(b.year));
    if (yc !== 0) return yc;

    const ao = getPeriodOrder(a.month);
    const bo = getPeriodOrder(b.month);
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    const mc = String(a.month || '').localeCompare(String(b.month || ''));
    if (mc !== 0) return mc;
    // Stable ordering by dimensions (if any)
    for (const k of dimensionKeys) {
      const dc = String(a?.[k] || '').localeCompare(String(b?.[k] || ''));
      if (dc !== 0) return dc;
    }
    return 0;
  });

  const structured = {
    source: sourceMeta,
    metrics,
    years,
    last_update: lastUpdate.toISOString(),
    table: {
      columns: tableColumns,
      data: tableRows,
    },
  };

  const signature = (!thIdsParam.length && useAll) ? 'all' : resolvedThIds.join(',');

  return { structured, signature, lastUpdate, metrics, periods };
}

module.exports = {
  buildMergedProcessed,
};
