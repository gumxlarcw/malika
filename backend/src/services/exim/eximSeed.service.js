const DataSource = require("../../models/DataSource.model");
const MergedCache = require("../../models/MergedCache.model");
const ProcessedCache = require("../../models/ProcessedCache.model");
const AutomationConfig = require("../../models/AutomationConfig.model");
const { fetchAPI } = require("../datasource/fetch.service");
const processExim = require("../processor/exim.processor");
const { responseHasData, findLatestAvailableEximYear, buildEximUrl } = require("./eximYearDiscovery.service");

const MONTH_ORDER = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function buildMergedCachePreview(structured, { maxRows = 2000 } = {}) {
  const table = structured?.table;
  const data = Array.isArray(table?.data) ? table.data : [];
  if (data.length <= maxRows) return structured;

  return {
    ...structured,
    table: {
      ...table,
      data: data.slice(0, maxRows),
      total_rows: data.length,
      truncated: true,
    },
  };
}

async function verifyEximIndicatorTableBps({ sequelizeBps, sourceId, expectedHs2Codes }) {
  const table = `indikator_${Number(sourceId)}`;
  const expected = Array.isArray(expectedHs2Codes) ? expectedHs2Codes.map(String) : [];

  const [[meta]] = await sequelizeBps.query(
    `SELECT MIN(year) AS min_year, MAX(year) AS max_year, COUNT(*) AS rows_total, COUNT(DISTINCT year) AS years_distinct, COUNT(DISTINCT hs2) AS hs2_distinct FROM \`${table}\``
  );

  const [metricRows] = await sequelizeBps.query(
    `SELECT metric, COUNT(*) AS cnt FROM \`${table}\` GROUP BY metric ORDER BY metric`
  );

  let keys;
  try {
    [[keys]] = await sequelizeBps.query(
      `SELECT COUNT(*) AS total_rows, COUNT(DISTINCT CONCAT(th_id,'|',month_no,'|',dim_hash)) AS distinct_keys FROM \`${table}\` WHERE metric IN ('value','netweight')`
    );
  } catch {
    [[keys]] = await sequelizeBps.query(
      `SELECT COUNT(*) AS total_rows, COUNT(DISTINCT CONCAT(th_id,'|',month_no,'|',dim_value)) AS distinct_keys FROM \`${table}\` WHERE metric IN ('value','netweight')`
    );
  }

  const [hs2Rows] = await sequelizeBps.query(
    `SELECT DISTINCT hs2 FROM \`${table}\` WHERE hs2 <> '' ORDER BY hs2 ASC`
  );
  const presentHs2 = hs2Rows.map((r) => String(r.hs2));
  const missingHs2 = expected.length ? expected.filter((c) => !presentHs2.includes(c)) : [];

  const distinctKeys = Number(keys?.distinct_keys || 0);
  const totalRows = Number(keys?.total_rows || 0);
  const expectedTotal = distinctKeys * 2;

  return {
    table,
    meta: {
      min_year: meta?.min_year != null ? Number(meta.min_year) : null,
      max_year: meta?.max_year != null ? Number(meta.max_year) : null,
      rows_total: meta?.rows_total != null ? Number(meta.rows_total) : null,
      years_distinct: meta?.years_distinct != null ? Number(meta.years_distinct) : null,
      hs2_distinct: meta?.hs2_distinct != null ? Number(meta.hs2_distinct) : null,
    },
    metrics: Array.isArray(metricRows)
      ? metricRows.map((r) => ({ metric: String(r.metric), cnt: Number(r.cnt) }))
      : [],
    completeness: {
      distinct_keys: distinctKeys,
      total_rows: totalRows,
      expected_total_rows_if_complete: expectedTotal,
      missing_rows_estimate: expectedTotal - totalRows,
    },
    hs2: {
      expected: expected.length,
      present: presentHs2.length,
      missing: missingHs2,
    },
  };
}

function normalizeMonthNo(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// HS-2 groups: full range 01..99 (per request)
// NOTE: HS2 names are not provided here; keep a stable label.
const HS2_GROUPS = Array.from({ length: 99 }, (_, idx) => {
  const code = String(idx + 1).padStart(2, '0');
  return { code, name: `HS ${code}` };
});

// EXIM variants:
// - sumber/1 = ekspor
// - sumber/2 = impor
const EXIM_VARIANTS = [
  { key: 'ekspor', sumber: 1, title: 'Ekspor' },
  { key: 'impor', sumber: 2, title: 'Impor' },
];

function buildUniversalEximUrlTemplate({ codeHs, sumber = 1 }) {
  // Based on provided universal link
  // - keep tahun template as {period}
  // - bake kodehs to fixed 2-digit code for this datasource
  return `https://webapi.bps.go.id/v1/api/dataexim/sumber/${Number(sumber)}/kodehs/${codeHs}/jenishs/1/tahun/{period}/periode/1/key/e5d1be11320576d466bdeb2f7f210387/`;
}

function buildMasterEximUrlTemplate({ sumber = 1 }) {
  // Master datasource: kodehs is provided at runtime (seed/automation) via {code_hs} placeholder.
  // Keep tahun template as {period}.
  return `https://webapi.bps.go.id/v1/api/dataexim/sumber/${Number(sumber)}/kodehs/{code_hs}/jenishs/1/tahun/{period}/periode/1/key/e5d1be11320576d466bdeb2f7f210387/`;
}

function isHsCodeInRange(code, from, to) {
  const n = Number(code);
  const f = Number(from);
  const t = Number(to);
  if (!Number.isFinite(n) || !Number.isFinite(f) || !Number.isFinite(t)) return false;
  return n >= f && n <= t;
}

async function buildMergedEximForDatasource({ ds, startYear = 2020, endYear, sourceId }) {
  const latestYear = await findLatestAvailableEximYear({
    ds,
    sourceId,
    startYear,
    endYear,
    // codeHs is baked into ds.api_url for seeding
    codeHs: null,
  });

  if (!latestYear) {
    return {
      structured: {
        source: { id: sourceId, name: ds.name || null },
        metrics: [],
        years: [],
        last_update: new Date(0).toISOString(),
        table: {
          columns: [
            { key: "year", label: "Tahun" },
            { key: "month", label: "Bulan" },
          ],
          data: [],
        },
      },
      metrics: [],
      lastUpdate: new Date(0),
      latestYear: null,
    };
  }

  const processedList = [];
  let lastUpdate = new Date(0);

  for (let year = startYear; year <= latestYear; year++) {
    const url = buildEximUrl(ds, year, null);
    const raw = await fetchAPI(url, sourceId);
    if (!responseHasData(raw)) continue;
    const processed = processExim(raw, { year: String(year) });
    processedList.push({ year: String(year), processed });
    const lu = processed?.last_update ? new Date(processed.last_update) : new Date(0);
    if (lu > lastUpdate) lastUpdate = lu;
  }

  const rows = [];
  for (const item of processedList) {
    const p = item.processed;
    if (Array.isArray(p?.data)) {
      p.data.forEach((row) =>
        rows.push({
          ...row,
          year: item.year,
          th_id: item.year,
          month_no: normalizeMonthNo(row?.month_no),
        })
      );
    }
  }

  // Metrics for EXIM are numeric measures only.
  const metrics = ["value", "netweight"];

  // 1) Detailed table rows (with pod/ctr/kodehs) for each HS2 datasource.
  const detailedTableRows = rows
    .map((r) => ({
      year: String(r.year),
      month: r.Bulan,
      pod: r.pod ?? null,
      ctr: r.ctr ?? null,
      kodehs: r.kodehs ?? null,
      value: r.value ?? null,
      netweight: r.netweight ?? null,
      th_id: String(r.th_id),
      month_no: normalizeMonthNo(r.month_no),
    }))
    .sort((a, b) => {
      const yc = String(a.year).localeCompare(String(b.year));
      if (yc !== 0) return yc;

      const an = a.month_no;
      const bn = b.month_no;
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      if (Number.isFinite(an)) return -1;
      if (Number.isFinite(bn)) return 1;

      const mc = MONTH_ORDER.indexOf(String(a.month)) - MONTH_ORDER.indexOf(String(b.month));
      if (mc !== 0) return mc;

      const pc = String(a.pod || '').localeCompare(String(b.pod || ''));
      if (pc !== 0) return pc;
      return String(a.ctr || '').localeCompare(String(b.ctr || ''));
    })
    .map(({ month_no, ...rest }) => rest);

  // No aggregation: keep years empty so consumers use table.data for analysis/filtering.
  const years = [];

  const structured = {
    source: { id: sourceId, name: ds.name || null },
    metrics,
    years,
    last_update: lastUpdate.toISOString(),
    table: {
      columns: [
        { key: "year", label: "Tahun" },
        { key: "month", label: "Bulan" },
        { key: "pod", label: "POD" },
        { key: "ctr", label: "CTR" },
        { key: "kodehs", label: "Kode HS" },
        ...metrics.map((m) => ({ key: m, label: m })),
      ],
      data: detailedTableRows,
    },
  };

  return { structured, metrics, lastUpdate, latestYear: Number(latestYear) };
}

async function buildMergedEximMasterForDatasource({
  ds,
  variantKey,
  startYear = 2020,
  endYear,
  sourceId,
  log,
}) {
  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(`[${new Date().toISOString()}] ${m}`);

  // Discover latest year per HS2 (best-effort) then build a combined detailed table.
  const perHsLatest = new Map();
  let globalLatest = null;
  let lastUpdate = new Date(0);

  for (const g of HS2_GROUPS) {
    const latest = await findLatestAvailableEximYear({
      ds,
      sourceId,
      startYear,
      endYear,
      codeHs: g.code,
    });
    if (latest) {
      perHsLatest.set(g.code, Number(latest));
      if (!globalLatest || Number(latest) > globalLatest) globalLatest = Number(latest);
    }
  }

  if (!globalLatest) {
    return {
      structured: {
        source: { id: sourceId, name: ds.name || null },
        metrics: [],
        years: [],
        last_update: new Date(0).toISOString(),
        table: {
          columns: [
            { key: 'year', label: 'Tahun' },
            { key: 'month', label: 'Bulan' },
            { key: 'hs2', label: 'HS2' },
            { key: 'hs2_name', label: 'HS2 Name' },
          ],
          data: [],
        },
      },
      metrics: [],
      lastUpdate: new Date(0),
      latestYear: null,
    };
  }

  info(`MASTER (${variantKey}): global latestYear=${globalLatest}`);

  const rows = [];
  for (const g of HS2_GROUPS) {
    const latest = perHsLatest.get(g.code);
    if (!latest) {
      info(`HS ${g.code} (${variantKey}): no data available, skip`);
      continue;
    }

    for (let year = startYear; year <= latest; year++) {
      const url = buildEximUrl(ds, year, g.code);
      const raw = await fetchAPI(url, sourceId);
      if (!responseHasData(raw)) continue;

      const processed = processExim(raw, { year: String(year) });
      const lu = processed?.last_update ? new Date(processed.last_update) : new Date(0);
      if (lu > lastUpdate) lastUpdate = lu;

      if (Array.isArray(processed?.data)) {
        for (const r of processed.data) {
          rows.push({
            year: String(year),
            th_id: String(year),
            month: r.Bulan,
            month_no: normalizeMonthNo(r?.month_no),
            hs2: g.code,
            hs2_name: g.name,
            pod: r.pod ?? null,
            ctr: r.ctr ?? null,
            kodehs: r.kodehs ?? null,
            value: r.value ?? null,
            netweight: r.netweight ?? null,
          });
        }
      }
    }

    info(`HS ${g.code} (${variantKey}): done`);
  }

  const metrics = ['value', 'netweight'];

  const detailedTableRows = rows
    .sort((a, b) => {
      const yc = String(a.year).localeCompare(String(b.year));
      if (yc !== 0) return yc;

      const an = a.month_no;
      const bn = b.month_no;
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      if (Number.isFinite(an)) return -1;
      if (Number.isFinite(bn)) return 1;

      const mc = MONTH_ORDER.indexOf(String(a.month)) - MONTH_ORDER.indexOf(String(b.month));
      if (mc !== 0) return mc;

      const hc = String(a.hs2 || '').localeCompare(String(b.hs2 || ''));
      if (hc !== 0) return hc;

      const pc = String(a.pod || '').localeCompare(String(b.pod || ''));
      if (pc !== 0) return pc;
      return String(a.ctr || '').localeCompare(String(b.ctr || ''));
    })
    .map(({ month_no, ...rest }) => rest);

  const structured = {
    source: { id: sourceId, name: ds.name || null },
    metrics,
    years: [],
    last_update: lastUpdate.toISOString(),
    table: {
      columns: [
        { key: 'year', label: 'Tahun' },
        { key: 'month', label: 'Bulan' },
        { key: 'hs2', label: 'HS2' },
        { key: 'hs2_name', label: 'HS2 Name' },
        { key: 'pod', label: 'POD' },
        { key: 'ctr', label: 'CTR' },
        { key: 'kodehs', label: 'Kode HS' },
        ...metrics.map((m) => ({ key: m, label: m })),
      ],
      data: detailedTableRows,
    },
  };

  return { structured, metrics, lastUpdate, latestYear: Number(globalLatest) };
}

async function seedEximDatasources({
  startYear = 2020,
  endYear = new Date().getFullYear(),
  visible = true,
  log,
  mode = 'master',
  excludeHsFrom,
  excludeHsTo,
}) {
  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(`[${new Date().toISOString()}] ${m}`);
  const warn = (m) => emit && emit(`[${new Date().toISOString()}] WARN: ${m}`);

  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const verification = [];

  if (String(mode) === 'master') {
    for (const variant of EXIM_VARIANTS) {
      const name = `EXIM ${variant.title} (ALL HS2)`;
      const apiUrl = buildMasterEximUrlTemplate({ sumber: variant.sumber });

      info(`MASTER (${variant.key}): start (create/update datasource + build merged cache)`);

      try {
        const now = new Date();
        const existing = await DataSource.findOne({ where: { type: 'exim', api_url: apiUrl } });

        let row;
        if (existing) {
          row = existing;
          await row.update({
            name,
            category: `EXIM ${variant.title}`,
            period_key: 'tahun',
            auto_period: true,
            status: true,
            visible,
            updated_at: now,
          });
          updated.push({ id: row.id, code: 'ALL', name: row.name });
          info(`MASTER (${variant.key}): updated datasource id=${row.id}`);
        } else {
          row = await DataSource.create({
            name,
            description: null,
            type: 'exim',
            api_url: apiUrl,
            period_key: 'tahun',
            auto_period: true,
            status: true,
            visible,
            display_order: 0,
            category: `EXIM ${variant.title}`,
            created_at: now,
            updated_at: now,
          });
          created.push({ id: row.id, code: 'ALL', name: row.name });
          info(`MASTER (${variant.key}): created datasource id=${row.id}`);
        }

        // Ensure automation config exists and enabled (no duplicates)
        try {
          const [cfg] = await AutomationConfig.findOrCreate({
            where: { source_id: row.id },
            defaults: {
              enabled: true,
              mode: 'daily',
              created_at: now,
              updated_at: now,
            },
          });
          if (!cfg.enabled || String(cfg.mode || '') !== 'daily') {
            await cfg.update({ enabled: true, mode: 'daily', updated_at: now });
          }
          info(`MASTER (${variant.key}): automation enabled (source_id=${row.id})`);
        } catch (e) {
          warn(`MASTER (${variant.key}): failed enabling automation: ${e?.message || String(e)}`);
        }

        const { structured, metrics, lastUpdate, latestYear } = await buildMergedEximMasterForDatasource({
          ds: row,
          variantKey: variant.key,
          startYear,
          endYear,
          sourceId: row.id,
          log: emit,
        });

        if (!latestYear) {
          skipped.push({ id: row.id, code: 'ALL', reason: 'no data available' });
          info(`MASTER (${variant.key}): skipped (no data available)`);
          continue;
        }

        const signature = `exim:${variant.key}:all`;

        // Save only a preview to merged_cache to avoid oversized packets / ECONNRESET.
        const structuredForCache = buildMergedCachePreview(structured, { maxRows: 2000 });

        await MergedCache.upsert({
          source_id: row.id,
          signature,
          merged_json: JSON.stringify(structuredForCache),
          last_update: new Date(lastUpdate.toISOString()),
          updated_at: new Date(),
        });

        info(`MASTER (${variant.key}): saved merged cache (latestYear=${latestYear}, signature=${signature})`);

        // Replicate to data_bps if configured (best-effort)
        try {
          const getSequelizeBps = require("../../config/db_bps");
          const getMergedCacheBpsModel = require("../../models_bps/MergedCacheBps.model");
          const sequelizeBps = getSequelizeBps();
          const MergedCacheBps = getMergedCacheBpsModel();
          if (sequelizeBps && MergedCacheBps) {
            info(`MASTER (${variant.key}): replication start (data_bps)`);
            await sequelizeBps.authenticate();
            info(`MASTER (${variant.key}): replication authenticated`);
            await sequelizeBps.sync();
            info(`MASTER (${variant.key}): replication synced`);
            await MergedCacheBps.upsert({
              source_id: row.id,
              signature,
              merged_json: JSON.stringify(structuredForCache),
              last_update: new Date(lastUpdate.toISOString()),
              updated_at: new Date(),
            });

            info(`MASTER (${variant.key}): replication merged_cache upserted`);

            const { replicateMergedToIndicatorTableBps } = require("../replication/indicatorTableBps.service");
            await replicateMergedToIndicatorTableBps({
              sequelizeBps,
              source: structured.source,
              signature,
              metrics,
              tableRows: structured.table.data,
              lastUpdate: lastUpdate.toISOString(),
              log: emit,
            });

            info(`MASTER (${variant.key}): replication indikator table done`);

            // Post-seed verification (single-step): make sure no HS2/years are missing.
            const expectedHs2 = HS2_GROUPS.map((g) => g.code);
            info(`MASTER (${variant.key}): verification start`);
            const v = await verifyEximIndicatorTableBps({
              sequelizeBps,
              sourceId: row.id,
              expectedHs2Codes: expectedHs2,
            });
            verification.push({ source_id: row.id, variant: variant.key, ...v });
            info(
              `VERIFY (${variant.key}) ${v.table}: years ${v.meta.min_year}-${v.meta.max_year}, hs2 ${v.hs2.present}/${v.hs2.expected}, missingHs2=${v.hs2.missing.length}, estMissingRows=${v.completeness.missing_rows_estimate}`
            );
            if (v.hs2.missing.length) {
              warn(`VERIFY (${variant.key}) missing HS2: ${v.hs2.missing.join(',')}`);
            }
            info(`MASTER (${variant.key}): verification done`);
          }
        } catch (e) {
          // Do not silently ignore: incomplete replication can look like "only 2020" in the dashboard.
          throw new Error(`Replication failed (data_bps): ${e?.message || String(e)}`);
        }

        info(`MASTER (${variant.key}): done`);
      } catch (e) {
        errors.push({ code: `master:${variant.key}`, message: e?.message || String(e) });
        warn(`MASTER (${variant.key}): ERROR: ${e?.message || String(e)}`);
      }
    }

    return { created, updated, skipped, errors, verification, total: HS2_GROUPS.length };
  }

  for (const g of HS2_GROUPS) {
    if (excludeHsFrom != null && excludeHsTo != null && isHsCodeInRange(g.code, excludeHsFrom, excludeHsTo)) {
      skipped.push({ code: g.code, reason: `excluded HS range ${excludeHsFrom}-${excludeHsTo}` });
      continue;
    }

    for (const variant of EXIM_VARIANTS) {
      const name = `EXIM ${variant.title} HS ${g.code} - ${g.name}`.slice(0, 150);
      const apiUrl = buildUniversalEximUrlTemplate({ codeHs: g.code, sumber: variant.sumber });

      info(`HS ${g.code} (${variant.key}): start (create/update datasource + build merged cache)`);

      try {
        const now = new Date();
        const existing = await DataSource.findOne({ where: { type: "exim", api_url: apiUrl } });

        let row;
        if (existing) {
          row = existing;
          await row.update({
            name,
            category: `EXIM ${variant.title}`,
            period_key: "tahun",
            auto_period: true,
            status: true,
            visible,
            updated_at: now,
          });
          updated.push({ id: row.id, code: g.code, name: row.name });
          info(`HS ${g.code} (${variant.key}): updated datasource id=${row.id}`);
        } else {
          row = await DataSource.create({
            name,
            description: null,
            type: "exim",
            api_url: apiUrl,
            period_key: "tahun",
            auto_period: true,
            status: true,
            visible,
            display_order: 0,
            category: `EXIM ${variant.title}`,
            created_at: now,
            updated_at: now,
          });
          created.push({ id: row.id, code: g.code, name: row.name });
          info(`HS ${g.code} (${variant.key}): created datasource id=${row.id}`);
        }

        // Ensure automation config exists and enabled (no duplicates)
        try {
          const [cfg] = await AutomationConfig.findOrCreate({
            where: { source_id: row.id },
            defaults: {
              enabled: true,
              mode: 'daily',
              created_at: now,
              updated_at: now,
            },
          });
          if (!cfg.enabled || String(cfg.mode || '') !== 'daily') {
            await cfg.update({ enabled: true, mode: 'daily', updated_at: now });
          }
          info(`HS ${g.code} (${variant.key}): automation enabled (source_id=${row.id})`);
        } catch (e) {
          warn(`HS ${g.code} (${variant.key}): failed enabling automation: ${e?.message || String(e)}`);
        }

        // Precompute + save merged cache for this datasource
        const { structured, metrics, lastUpdate, latestYear } = await buildMergedEximForDatasource({
          ds: row,
          startYear,
          endYear,
          sourceId: row.id,
        });

        if (!latestYear) {
          skipped.push({ id: row.id, code: g.code, reason: "no data available" });
          info(`HS ${g.code} (${variant.key}): skipped (no data available)`);
          continue;
        }

        const signature = `exim:${variant.key}:${g.code}`;

        await MergedCache.upsert({
          source_id: row.id,
          signature,
          merged_json: JSON.stringify(structured),
          last_update: new Date(lastUpdate.toISOString()),
          updated_at: new Date(),
        });

        info(`HS ${g.code} (${variant.key}): saved merged cache (latestYear=${latestYear}, signature=${signature})`);

        // Replicate to data_bps if configured (best-effort)
        try {
          const getSequelizeBps = require("../../config/db_bps");
          const getMergedCacheBpsModel = require("../../models_bps/MergedCacheBps.model");
          const sequelizeBps = getSequelizeBps();
          const MergedCacheBps = getMergedCacheBpsModel();
          if (sequelizeBps && MergedCacheBps) {
            await sequelizeBps.authenticate();
            await sequelizeBps.sync();
            await MergedCacheBps.upsert({
              source_id: row.id,
              signature,
              merged_json: JSON.stringify(structured),
              last_update: new Date(lastUpdate.toISOString()),
              updated_at: new Date(),
            });

            const { replicateMergedToIndicatorTableBps } = require("../replication/indicatorTableBps.service");
            await replicateMergedToIndicatorTableBps({
              sequelizeBps,
              source: structured.source,
              signature,
              metrics,
              tableRows: structured.table.data,
              lastUpdate: lastUpdate.toISOString(),
              log: emit,
            });
          }
        } catch {
          // ignore replication errors
        }

        info(`HS ${g.code} (${variant.key}): done`);
      } catch (e) {
        errors.push({ code: `${g.code}:${variant.key}`, message: e?.message || String(e) });
        warn(`HS ${g.code} (${variant.key}): ERROR: ${e?.message || String(e)}`);
      }
    }
  }

  return { created, updated, skipped, errors, verification, total: HS2_GROUPS.length };
}

module.exports = {
  HS2_GROUPS,
  EXIM_VARIANTS,
  buildUniversalEximUrlTemplate,
  buildMasterEximUrlTemplate,
  seedEximDatasources,
};
