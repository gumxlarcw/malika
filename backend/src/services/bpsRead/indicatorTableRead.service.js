const getSequelizeBps = require('../../config/db_bps');
const { getHs2IndonesianNames } = require('../exim/hs2Lookup.service');

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

function normalizeLike(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  return `%${s}%`;
}

function pickSingleLabelFromRows(rows, field) {
  const firstByKey = new Map();
  for (const r of rows || []) {
    const v = r?.[field];
    if (v == null) continue;
    const raw = String(v).trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!firstByKey.has(key)) firstByKey.set(key, raw);
    if (firstByKey.size > 1) return null;
  }
  if (firstByKey.size !== 1) return null;
  return Array.from(firstByKey.values())[0] || null;
}

function parseLastUpdateDate(input) {
  if (!input) return null;

  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;

  // Guardrail: some indicator tables have a default/invalid epoch timestamp.
  // Treat anything earlier than year 2000 as "unknown".
  if (d.getUTCFullYear() < 2000) return null;

  return d;
}

function pickMaxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a > b ? a : b;
}

function formatLastUpdateDate(d) {
  return d ? d.toISOString().slice(0, 19).replace('T', ' ') : null;
}

async function getTableLastUpdate(sequelizeBps, tableName) {
  try {
    const [rows] = await sequelizeBps.query(
      `SELECT MAX(last_update) AS last_update
       FROM \`${tableName}\`
       WHERE metric IN ("value", "netweight")`
    );
    return parseLastUpdateDate(rows?.[0]?.last_update);
  } catch (e) {
    // Best-effort: never break EXIM reads just because this aggregate fails.
    return null;
  }
}

/**
 * Read EXIM-formatted rows from data_bps.indikator_<sourceId>.
 * This table is metabase-oriented and stores one row per metric (value/netweight).
 * We pivot metrics into { value, netweight } per dimension row.
 */
async function readEximFromBps({ sourceId, year, monthNo, hs2, pod, ctr, metricWanted, groupBy = null }) {
  const sequelizeBps = getSequelizeBps();
  if (!sequelizeBps) return null;

  const y = Number(year);
  if (!Number.isFinite(y)) return null;

  const tableName = getIndicatorTableName(sourceId);
  const exists = await tableExists(sequelizeBps, tableName);
  if (!exists) return null;

  // EXIM indicator tables represent a single dataset that can span multiple years.
  // UI "Update" should reflect the dataset's latest refresh, not just the selected year slice.
  const tableLastUpdate = await getTableLastUpdate(sequelizeBps, tableName);

  const wantMonth = Number.isFinite(Number(monthNo)) && Number(monthNo) >= 1 && Number(monthNo) <= 12;
  const hs2Norm = hs2 ? String(hs2).trim().padStart(2, '0') : '';
  const wantHs2 = hs2Norm.length === 2;
  const group = String(groupBy || '').trim().toLowerCase();
  const wantGroupHs2 = group === 'hs2';
  const wantGroupPod = group === 'pod';
  const wantGroupCtr = group === 'ctr';
  const wantGroupDetail = group === 'detail';
  const wantGroupHs2Ctr = group === 'hs2ctr';
  const wantGroupHs2Pod = group === 'hs2pod';

  const podLike = normalizeLike(pod);
  const ctrLike = normalizeLike(ctr);

  // Only read the two metrics we expose for EXIM.
  // We intentionally avoid changing schema and keep queries simple.
  const where = [
    'year = ?',
    'metric IN ("value", "netweight")',
    'month_no BETWEEN 1 AND 12',
  ];
  const replacements = [y];

  if (wantMonth) {
    where.push('month_no = ?');
    replacements.push(Number(monthNo));
  }
  if (wantHs2) {
    where.push('hs2 = ?');
    replacements.push(hs2Norm);
  }
  if (podLike) {
    where.push('pod LIKE ?');
    replacements.push(podLike);
  }
  if (ctrLike) {
    where.push('ctr LIKE ?');
    replacements.push(ctrLike);
  }

  const sql = `
    SELECT
      month_no,
      month_name,
      hs2,
      hs2_name,
      pod,
      ctr,
      kodehs,
      dim_hash,
      metric,
      value,
      last_update
    FROM \`${tableName}\`
    WHERE ${where.join(' AND ')}
    ORDER BY month_no ASC
  `;

  const [rows] = await sequelizeBps.query(sql, { replacements });
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;

  const uniqueHs2FromRows = Array.from(
    new Set(
      list
        .map((r) => String(r?.hs2 || '').trim())
        .map((s) => (s ? s.padStart(2, '0').slice(0, 2) : ''))
        .filter(Boolean)
    )
  );
  const hs2NameMap = uniqueHs2FromRows.length > 0 ? await getHs2IndonesianNames(uniqueHs2FromRows) : new Map();

  const kodehsFixed = (() => {
    if (!wantHs2) return null;
    const hs2Key = String(hs2Norm || '').padStart(2, '0').slice(0, 2);
    const lookedUp = hs2Key ? hs2NameMap.get(hs2Key) : null;
    if (lookedUp) return `[${hs2Key}] ${lookedUp}`;
    // Fall back to first row's kodehs/hs2_name if available.
    const firstKodehs = list.find((r) => r?.kodehs)?.kodehs;
    if (firstKodehs) return String(firstKodehs);
    const firstName = list.find((r) => r?.hs2_name)?.hs2_name;
    if (firstName) return `[${hs2Key}] ${String(firstName)}`;
    return `HS ${hs2Key}`;
  })();

  // If filters are applied and the matched rows all have a single distinct label, reflect it
  // in aggregated outputs (ALL HS2 / groupBy=hs2) without trusting query text.
  const podLabel = podLike ? pickSingleLabelFromRows(list, 'pod') : null;
  const ctrLabel = ctrLike ? pickSingleLabelFromRows(list, 'ctr') : null;

  // If user didn't specify HS2, either:
  // - groupBy=hs2: aggregate totals per HS2 (and month)
  // - groupBy=pod: aggregate totals per POD (and month)
  // - groupBy=ctr: aggregate totals per CTR (and month)
  // - groupBy=hs2ctr: aggregate totals per (HS2, CTR) (and month)
  // - groupBy=hs2pod: aggregate totals per (HS2, POD) (and month)
  // - default: mimic controller "ALL HS2" by aggregating totals across all dimensions per month
  if (!wantHs2 && wantGroupHs2) {
    const totals = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const hs2Row = String(r?.hs2 || '').trim();
      const hs2Name = String(r?.hs2_name || '').trim();
      if (!hs2Row) continue;

      const key = `${m}|${hs2Row}`;
      const cur = totals.get(key) || { month_no: m, hs2: hs2Row, hs2_name: hs2Name, value: 0, netweight: 0 };

      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;
      if (!cur.hs2_name && hs2Name) cur.hs2_name = hs2Name;

      totals.set(key, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const uniqueHs2 = Array.from(new Set(Array.from(totals.values()).map((x) => String(x?.hs2 || '').trim()).filter(Boolean)));
    const nameMap = await getHs2IndonesianNames(uniqueHs2);

    const dataAll = Array.from(totals.values())
      .sort((a, b) => (a.month_no - b.month_no) || String(a.hs2).localeCompare(String(b.hs2)))
      .map((x) => {
        const hs2Code = String(x.hs2).padStart(2, '0');
        const lookedUp = nameMap.get(hs2Code) || null;
        const hs2NameFinal = lookedUp || (x.hs2_name && String(x.hs2_name).trim() ? String(x.hs2_name).trim() : null);
        const kodehs = hs2NameFinal ? `[${hs2Code}] ${hs2NameFinal}` : `HS ${hs2Code}`;
        return {
          Bulan: monthNoToLabel(x.month_no) || String(x.month_no),
          month_no: x.month_no,
          // If user filters by pod/ctr, reflect the filter label in grouped output.
          pod: podLabel,
          ctr: ctrLabel,
          kodehs,
          hs2: hs2Code,
          hs2_name: hs2NameFinal,
          value: Number.isFinite(x.value) ? x.value : null,
          netweight: Number.isFinite(x.netweight) ? x.netweight : null,
        };
      });

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    const columns = metricWanted
      ? ['Bulan', 'kodehs', metricWanted]
      : ['Bulan', 'kodehs', 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        kodehs: 'Komoditas (HS2)',
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'group_hs2' },
    };
  }

  if (!wantHs2 && wantGroupHs2Ctr) {
    const totals = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const hs2Row = String(r?.hs2 || '').trim();
      if (!hs2Row) continue;
      const ctrRow = String(r?.ctr || '').trim();
      if (!ctrRow) continue;

      const key = `${m}|${hs2Row}|${ctrRow.toLowerCase()}`;
      const cur = totals.get(key) || { month_no: m, hs2: hs2Row, ctr: ctrRow, hs2_name: String(r?.hs2_name || '').trim(), value: 0, netweight: 0 };

      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;
      if (!cur.hs2_name && r?.hs2_name) cur.hs2_name = String(r.hs2_name).trim();

      totals.set(key, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const uniqueHs2 = Array.from(new Set(Array.from(totals.values()).map((x) => String(x?.hs2 || '').trim()).filter(Boolean)));
    const nameMap = await getHs2IndonesianNames(uniqueHs2);

    const dataAll = Array.from(totals.values())
      .sort((a, b) => (a.month_no - b.month_no) || String(a.hs2).localeCompare(String(b.hs2)) || String(a.ctr).localeCompare(String(b.ctr)))
      .map((x) => {
        const hs2Code = String(x.hs2).padStart(2, '0');
        const lookedUp = nameMap.get(hs2Code) || null;
        const hs2NameFinal = lookedUp || (x.hs2_name && String(x.hs2_name).trim() ? String(x.hs2_name).trim() : null);
        const kodehs = hs2NameFinal ? `[${hs2Code}] ${hs2NameFinal}` : `HS ${hs2Code}`;
        return {
          Bulan: monthNoToLabel(x.month_no) || String(x.month_no),
          month_no: x.month_no,
          ctr: x.ctr,
          kodehs,
          hs2: hs2Code,
          hs2_name: hs2NameFinal,
          value: Number.isFinite(x.value) ? x.value : null,
          netweight: Number.isFinite(x.netweight) ? x.netweight : null,
        };
      });

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    const columns = metricWanted
      ? ['Bulan', 'ctr', 'kodehs', metricWanted]
      : ['Bulan', 'ctr', 'kodehs', 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        ctr: 'Negara',
        kodehs: 'Komoditas (HS2)',
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'group_hs2ctr' },
    };
  }

  if (!wantHs2 && wantGroupHs2Pod) {
    const totals = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const hs2Row = String(r?.hs2 || '').trim();
      if (!hs2Row) continue;
      const podRow = String(r?.pod || '').trim();
      if (!podRow) continue;

      const key = `${m}|${hs2Row}|${podRow.toLowerCase()}`;
      const cur = totals.get(key) || { month_no: m, hs2: hs2Row, pod: podRow, hs2_name: String(r?.hs2_name || '').trim(), value: 0, netweight: 0 };

      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;
      if (!cur.hs2_name && r?.hs2_name) cur.hs2_name = String(r.hs2_name).trim();

      totals.set(key, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const uniqueHs2 = Array.from(new Set(Array.from(totals.values()).map((x) => String(x?.hs2 || '').trim()).filter(Boolean)));
    const nameMap = await getHs2IndonesianNames(uniqueHs2);

    const dataAll = Array.from(totals.values())
      .sort((a, b) => (a.month_no - b.month_no) || String(a.hs2).localeCompare(String(b.hs2)) || String(a.pod).localeCompare(String(b.pod)))
      .map((x) => {
        const hs2Code = String(x.hs2).padStart(2, '0');
        const lookedUp = nameMap.get(hs2Code) || null;
        const hs2NameFinal = lookedUp || (x.hs2_name && String(x.hs2_name).trim() ? String(x.hs2_name).trim() : null);
        const kodehs = hs2NameFinal ? `[${hs2Code}] ${hs2NameFinal}` : `HS ${hs2Code}`;
        return {
          Bulan: monthNoToLabel(x.month_no) || String(x.month_no),
          month_no: x.month_no,
          pod: x.pod,
          kodehs,
          hs2: hs2Code,
          hs2_name: hs2NameFinal,
          value: Number.isFinite(x.value) ? x.value : null,
          netweight: Number.isFinite(x.netweight) ? x.netweight : null,
        };
      });

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    const columns = metricWanted
      ? ['Bulan', 'pod', 'kodehs', metricWanted]
      : ['Bulan', 'pod', 'kodehs', 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        pod: 'Pelabuhan (POD)',
        kodehs: 'Komoditas (HS2)',
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'group_hs2pod' },
    };
  }

  if (wantGroupCtr) {
    const totals = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const ctrRow = String(r?.ctr || '').trim();
      if (!ctrRow) continue;

      const key = `${m}|${ctrRow.toLowerCase()}`;
      const cur = totals.get(key) || { month_no: m, ctr: ctrRow, value: 0, netweight: 0 };

      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;

      totals.set(key, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const dataAll = Array.from(totals.values())
      .sort((a, b) => (a.month_no - b.month_no) || String(a.ctr).localeCompare(String(b.ctr)))
      .map((x) => ({
        Bulan: monthNoToLabel(x.month_no) || String(x.month_no),
        month_no: x.month_no,
        ctr: x.ctr,
        ...(kodehsFixed ? { kodehs: kodehsFixed } : {}),
        value: Number.isFinite(x.value) ? x.value : null,
        netweight: Number.isFinite(x.netweight) ? x.netweight : null,
      }));

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    const columnsBase = ['Bulan', 'ctr', ...(kodehsFixed ? ['kodehs'] : [])];
    const columns = metricWanted
      ? [...columnsBase, metricWanted]
      : [...columnsBase, 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        ctr: 'Negara',
        ...(kodehsFixed ? { kodehs: 'Komoditas (HS2)' } : {}),
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'group_ctr' },
    };
  }

  if (wantGroupPod) {
    const totals = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const podRow = String(r?.pod || '').trim();
      if (!podRow) continue;

      const key = `${m}|${podRow.toLowerCase()}`;
      const cur = totals.get(key) || { month_no: m, pod: podRow, value: 0, netweight: 0 };

      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;

      totals.set(key, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const dataAll = Array.from(totals.values())
      .sort((a, b) => (a.month_no - b.month_no) || String(a.pod).localeCompare(String(b.pod)))
      .map((x) => ({
        Bulan: monthNoToLabel(x.month_no) || String(x.month_no),
        month_no: x.month_no,
        pod: x.pod,
        ...(kodehsFixed ? { kodehs: kodehsFixed } : {}),
        value: Number.isFinite(x.value) ? x.value : null,
        netweight: Number.isFinite(x.netweight) ? x.netweight : null,
      }));

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    const columnsBase = ['Bulan', 'pod', ...(kodehsFixed ? ['kodehs'] : [])];
    const columns = metricWanted
      ? [...columnsBase, metricWanted]
      : [...columnsBase, 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        pod: 'Pelabuhan (POD)',
        ...(kodehsFixed ? { kodehs: 'Komoditas (HS2)' } : {}),
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'group_pod' },
    };
  }

  // Detail matrix without HS2 filter: aggregate ALL HS2 by (month_no, pod, ctr).
  // This matches user intent like "menurut negara dan pelabuhan" when they don't specify a commodity.
  if (!wantHs2 && wantGroupDetail) {
    const totals = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const podRowRaw = String(r?.pod || '').trim();
      const ctrRowRaw = String(r?.ctr || '').trim();
      const podRow = podRowRaw || 'Tidak diketahui';
      const ctrRow = ctrRowRaw || 'Tidak diketahui';

      const key = `${m}|${podRow.toLowerCase()}|${ctrRow.toLowerCase()}`;
      const cur = totals.get(key) || { month_no: m, pod: podRow, ctr: ctrRow, value: 0, netweight: 0 };

      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;

      totals.set(key, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const dataAll = Array.from(totals.values())
      .sort(
        (a, b) =>
          (a.month_no - b.month_no) ||
          String(a.pod).localeCompare(String(b.pod)) ||
          String(a.ctr).localeCompare(String(b.ctr))
      )
      .map((x) => ({
        Bulan: monthNoToLabel(x.month_no) || String(x.month_no),
        month_no: x.month_no,
        pod: x.pod,
        ctr: x.ctr,
        kodehs: 'ALL HS2',
        value: Number.isFinite(x.value) ? x.value : null,
        netweight: Number.isFinite(x.netweight) ? x.netweight : null,
      }));

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    const columnsBase = ['Bulan', 'pod', 'ctr', 'kodehs'];
    const columns = metricWanted
      ? [...columnsBase, metricWanted]
      : [...columnsBase, 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        pod: 'Pelabuhan (POD)',
        ctr: 'Negara',
        kodehs: 'Komoditas (HS2)',
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'group_detail' },
    };
  }

  if (!wantHs2) {
    const totalsByMonth = new Map();
    let maxLastUpdate = null;

    for (const r of list) {
      const m = Number(r?.month_no);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;

      const cur = totalsByMonth.get(m) || { value: 0, netweight: 0 };
      const metric = String(r?.metric || '').toLowerCase();
      const v = r?.value == null ? null : Number(r.value);
      if (metric === 'value' && Number.isFinite(v)) cur.value += v;
      if (metric === 'netweight' && Number.isFinite(v)) cur.netweight += v;
      totalsByMonth.set(m, cur);

      const lu = parseLastUpdateDate(r?.last_update);
      if (lu) {
        if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
      }
    }

    const dataAll = Array.from(totalsByMonth.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([m, sums]) => ({
        Bulan: monthNoToLabel(m) || String(m),
        month_no: m,
        // If user filters by pod/ctr, reflect the filter label in aggregated output.
        pod: podLabel,
        ctr: ctrLabel,
        kodehs: 'ALL HS2',
        value: Number.isFinite(sums?.value) ? sums.value : null,
        netweight: Number.isFinite(sums?.netweight) ? sums.netweight : null,
      }));

    const data = metricWanted
      ? dataAll.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
      : dataAll;

    // Only expose pod/ctr columns when the caller actually filtered to a single label.
    // Otherwise, showing "Semua Pelabuhan/Negara" is misleading (it's just a grand total).
    const columnsBase = ['Bulan', ...(podLabel ? ['pod'] : []), ...(ctrLabel ? ['ctr'] : []), 'kodehs'];
    const columns = metricWanted
      ? [...columnsBase, metricWanted]
      : [...columnsBase, 'value', 'netweight'];

    return {
      period: String(y),
      columns,
      labels: {
        value: 'Value',
        netweight: 'Netweight',
        kodehs: 'Kode HS',
        ...(podLabel ? { pod: 'POD' } : {}),
        ...(ctrLabel ? { ctr: 'CTR' } : {}),
      },
      data,
      source: 'EXIM',
      last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
      meta: { from: 'data_bps', table: tableName, mode: 'all_hs2_summary' },
    };
  }

  const byKey = new Map();
  let maxLastUpdate = null;

  for (const r of list) {
    const m = Number(r?.month_no);
    if (!Number.isFinite(m) || m < 1 || m > 12) continue;

    const monthLabel = monthNoToLabel(m) || String(r?.month_name || r?.month_no || m);
    const key = [
      String(m),
      String(r?.dim_hash || ''),
      String(r?.pod || ''),
      String(r?.ctr || ''),
      String(r?.kodehs || ''),
    ].join('|');

    const existing = byKey.get(key) || {
      Bulan: monthLabel,
      month_no: m,
      pod: r?.pod || null,
      ctr: r?.ctr || null,
      kodehs: (() => {
        const hs2Code = String(r?.hs2 || hs2Norm || '').trim();
        const hs2Key = hs2Code ? hs2Code.padStart(2, '0').slice(0, 2) : '';
        const lookedUp = hs2Key ? hs2NameMap.get(hs2Key) : null;
        if (wantHs2 && lookedUp) return `[${hs2Key}] ${lookedUp}`;
        // Fall back to what the row already has (often already labeled).
        if (r?.kodehs) return r.kodehs;
        return wantHs2 ? `HS ${hs2Norm}` : 'ALL HS2';
      })(),
      value: null,
      netweight: null,
    };

    const metric = String(r?.metric || '').toLowerCase();
    if (metric === 'value') existing.value = r?.value == null ? null : Number(r.value);
    if (metric === 'netweight') existing.netweight = r?.value == null ? null : Number(r.value);

    byKey.set(key, existing);

    const lu = parseLastUpdateDate(r?.last_update);
    if (lu) {
      if (!maxLastUpdate || lu > maxLastUpdate) maxLastUpdate = lu;
    }
  }

  const dataAll = Array.from(byKey.values()).sort((a, b) => a.month_no - b.month_no);

  const data = metricWanted
    ? dataAll.map((r) => {
        const next = { ...r };
        if (metricWanted === 'value') delete next.netweight;
        if (metricWanted === 'netweight') delete next.value;
        return next;
      })
    : dataAll;

  const columns = metricWanted
    ? ['Bulan', 'pod', 'ctr', 'kodehs', metricWanted]
    : ['Bulan', 'pod', 'ctr', 'kodehs', 'value', 'netweight'];

  return {
    period: String(y),
    columns,
    labels: {
      value: 'Value',
      netweight: 'Netweight',
      kodehs: 'Kode HS',
      pod: 'POD',
      ctr: 'CTR',
    },
    data,
    source: 'EXIM',
    last_update: formatLastUpdateDate(pickMaxDate(maxLastUpdate, tableLastUpdate)),
    meta: { from: 'data_bps', table: tableName },
  };
}

module.exports = {
  readEximFromBps,
};
