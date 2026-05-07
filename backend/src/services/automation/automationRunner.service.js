const DataSource = require('../../models/DataSource.model');
const MergedCache = require('../../models/MergedCache.model');
const AutomationConfig = require('../../models/AutomationConfig.model');
const AutomationRunLog = require('../../models/AutomationRunLog.model');
const { buildMergedProcessed } = require('../merge/mergeBuilder.service');
const DataPeriod = require('../../models/DataPeriod.model');
const { fetchAPI } = require('../datasource/fetch.service');
const processInterop = require('../processor/interop.processor');
const processStatic = require('../processor/static.processor');
const processExim = require('../processor/exim.processor');
const { buildEximUrl, responseHasData, findLatestAvailableEximYear } = require('../exim/eximYearDiscovery.service');
const EximPodFilter = require('../../models/EximPodFilter.model');
const { pullPressRelease } = require('../pressrelease/pull.service');
const { generatePeriodMap } = require('../period/generatePeriodMap.service');
const { syncMetadataIndexForTable } = require('../search/metadataIndex.service');

async function getEximPodAllowlist(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return [];
  try {
    const row = await EximPodFilter.findOne({ where: { source_id: sid } });
    if (!row || !row.enabled || !row.pods_json) return [];
    const parsed = JSON.parse(String(row.pods_json));
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const MONTH_ORDER = [
  'Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'
];

const MIN_ACCEPTABLE_LAST_UPDATE = new Date('2000-01-01T00:00:00.000Z');

function toAcceptableDateOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < MIN_ACCEPTABLE_LAST_UPDATE.getTime()) return null;
  return d;
}

function toAnyValidDateOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

function toISOStringSafe(value) {
  const d = value instanceof Date ? value : null;
  if (!d || Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

async function resolveLastUpdateFallback({ sourceId, signature, candidate, finishedAt }) {
  // Prefer a meaningful upstream-derived timestamp. If unavailable, DO NOT bump to "now"
  // because that would trigger merged-cache watcher false notifications.
  const directAcceptable = toAcceptableDateOrNull(candidate);
  if (directAcceptable) return directAcceptable;

  const directAny = toAnyValidDateOrNull(candidate);

  try {
    const existing = await MergedCache.findOne({
      where: { source_id: sourceId, signature: signature || 'all' },
    });

    // Keep existing value if present (even if it's old), to avoid "repair jumps".
    const existingAny = toAnyValidDateOrNull(existing?.last_update);
    if (existingAny) return existingAny;
  } catch {
    // best-effort
  }

  // If we have a parseable candidate (even if very old), use it.
  if (directAny) return directAny;

  // Last resort: only when there's truly no prior value at all.
  return finishedAt instanceof Date ? finishedAt : new Date();
}

function formatJayapuraTimestamp(dt = new Date()) {
  // Force GMT+9 (Asia/Jayapura) regardless of server timezone.
  // Produces ISO-like: YYYY-MM-DDTHH:mm:ss+09:00
  const ms = dt instanceof Date ? dt.getTime() : Date.now();
  const local = new Date(ms + 9 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 19) + '+09:00';
}

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

function buildMergedCachePreviewTail(structured, { maxRows = 2000 } = {}) {
  const table = structured?.table;
  const data = Array.isArray(table?.data) ? table.data : [];
  if (data.length <= maxRows) return structured;

  return {
    ...structured,
    table: {
      ...table,
      data: data.slice(Math.max(0, data.length - maxRows)),
      total_rows: data.length,
      truncated: true,
    },
  };
}

async function findLatestActiveEximYearByProbing({ ds, sourceId, startYear = 2020, maxProbeYear, codeHs = null }) {
  const maxYear = Number.isFinite(Number(maxProbeYear)) ? Number(maxProbeYear) : new Date().getFullYear() + 1;
  let lastYearWithData = null;

  for (let year = Number(startYear); year <= maxYear; year++) {
    const url = buildEximUrl(ds, year, codeHs);
    const raw = await fetchAPI(url, sourceId);
    const has = responseHasData(raw);

    if (has) {
      lastYearWithData = year;
      continue;
    }

    // stop at first empty year after we have seen data
    if (lastYearWithData != null) break;
  }

  return lastYearWithData;
}

async function findLatestActiveEximYearMasterByProbing({ ds, sourceId, hs2Groups, startYear = 2020, maxProbeYear }) {
  const maxYear = Number.isFinite(Number(maxProbeYear)) ? Number(maxProbeYear) : new Date().getFullYear() + 1;
  let lastYearWithData = null;

  for (let year = Number(startYear); year <= maxYear; year++) {
    let yearHasData = false;

    for (const g of hs2Groups) {
      const url = buildEximUrl(ds, year, g.code);
      const raw = await fetchAPI(url, sourceId);
      if (responseHasData(raw)) {
        yearHasData = true;
        break;
      }
    }

    if (yearHasData) {
      lastYearWithData = year;
      continue;
    }

    if (lastYearWithData != null) break;
  }

  return lastYearWithData;
}

function tryParseMergedJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

const inFlightSourceIds = new Set();

function createAlreadyRunningError(sourceId) {
  const err = new Error(`Automation already running for source_id=${sourceId}`);
  err.status = 409;
  err.code = 'AUTOMATION_ALREADY_RUNNING';
  return err;
}

async function getLatestAvailableThId(sourceId) {
  const { fetchAvailablePeriodsForSource } = require('../period/fetchAvailable.service');
  const periods = await fetchAvailablePeriodsForSource(sourceId);
  if (!periods?.length) return null;
  const sorted = [...periods].sort((a, b) => String(a.year).localeCompare(String(b.year)));
  return String(sorted[sorted.length - 1].th_id);
}

async function getRemoteLastUpdateForTh(sourceId, thId) {
  const { fetchRawByTh } = require('../period/fetchByTh.service');
  const processDynamic = require('../processor/dynamic.processor');
  const raw = await fetchRawByTh(sourceId, thId);
  const processed = processDynamic(raw);
  const lu = processed?.last_update ? new Date(processed.last_update) : null;
  return lu;
}

async function runAutomationForSource({ sourceId, mode = 'daily', log }) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid sourceId');

  if (inFlightSourceIds.has(id)) {
    throw createAlreadyRunningError(id);
  }

  inFlightSourceIds.add(id);

  try {
  const externalLog = typeof log === 'function' ? log : null;
  const internalLogs = [];
  const emit = (m) => {
    const line = `[${formatJayapuraTimestamp()}] ${m}`;
    internalLogs.push(line);
    if (externalLog) externalLog(line);
  };
  const info = (m) => emit(m);
  const warn = (m) => emit(`WARN: ${m}`);

  const ds = await DataSource.findByPk(id);
  if (!ds) throw new Error('DataSource not found');

  info(`Datasource: id=${id}, name=${ds.name || ''}`);

  const dsType = String(ds.type || 'dynamic').toLowerCase();
  info(`Datasource type: ${dsType}`);

  const startedAt = new Date();
  const now = startedAt;

  // Ensure config row exists
  const [cfg] = await AutomationConfig.findOrCreate({
    where: { source_id: id },
    defaults: {
      enabled: false,
      mode,
      created_at: now,
      updated_at: now,
    },
  });

  await cfg.update({
    mode,
    last_run_at: now,
    last_pull_started_at: now,
    last_error: null,
    updated_at: now,
  });

  info(`Config updated: mode=${mode}`);

  // "smart" mode: supported for dynamic (BPS th_id availability) and exim (update last active year only)
  if (mode === 'smart' && dsType === 'dynamic') {
    info('Smart mode: checking latest BPS update before full refresh');
    
    // Refresh period map from BPS availability API (best-effort, append-only via upsert)
    // This ensures new periods (e.g., 2026) are added to data_period_map automatically.
    info('Smart mode (dynamic): refreshing period map from BPS availability (best-effort)');
    try {
      await generatePeriodMap(id);
      info('Period map refreshed successfully');
    } catch (e) {
      warn(`Failed to refresh period map: ${e?.message || String(e)}`);
    }
    
    const latestThId = await getLatestAvailableThId(id);
    if (latestThId) {
      info(`Latest th_id detected: ${latestThId}`);
      const remoteLu = await getRemoteLastUpdateForTh(id, latestThId);
      info(`Remote last_update (latest th_id): ${remoteLu ? remoteLu.toISOString() : 'null'}`);
      const saved = await MergedCache.findOne({ where: { source_id: id, signature: 'all' } });
      const savedLu = saved?.last_update ? new Date(saved.last_update) : null;
      info(`Saved merged_cache last_update (signature=all): ${savedLu ? savedLu.toISOString() : 'null'}`);
      if (remoteLu && savedLu && remoteLu <= savedLu) {
        info('No newer update; skipping full refresh');
        const finishedAt = new Date();
        await cfg.update({
          last_pull_finished_at: finishedAt,
          last_bps_last_update: remoteLu,
          last_signature: 'all',
          last_success_at: finishedAt,
          last_error: null,
          updated_at: finishedAt,
        });

        // Persist last run logs even when skipping.
        try {
          const joined = internalLogs.join('\n');
          const capped = joined.length > 50_000 ? joined.slice(joined.length - 50_000) : joined;
          await AutomationRunLog.create({
            source_id: id,
            mode,
            ok: true,
            started_at: startedAt,
            finished_at: finishedAt,
            error: null,
            logs: capped,
            created_at: finishedAt,
          });
        } catch {
          // best-effort
        }

        return {
          ok: true,
          skipped: true,
          reason: 'No newer BPS update',
          remote_last_update: remoteLu.toISOString(),
        };
      }
    }
  } else if (mode === 'smart' && dsType !== 'dynamic' && dsType !== 'exim') {
    info(`Smart mode not supported for type=${dsType}; running full refresh`);
  }

  // Pressrelease: special flow (keyword-based), does NOT use merged cache nor indikator_<id> replication.
  // It writes to ProcessedCache and (when enabled) to data_bps table per keyword.
  if (dsType === 'pressrelease') {
    const dsKeywordRaw = String(ds.api_url || '').trim();
    const keyword = dsKeywordRaw.toLowerCase().startsWith('keyword:')
      ? dsKeywordRaw.slice('keyword:'.length).trim()
      : dsKeywordRaw;

    if (!keyword) {
      const err = new Error('Pressrelease datasource membutuhkan keyword pada api_url (format: keyword:<kw>)');
      err.status = 400;
      throw err;
    }

    info(`Pressrelease keyword: ${keyword}`);

    const pr = await pullPressRelease({
      sourceId: id,
      keywordOverride: keyword,
      saveToBps: true,
      forceRefresh: true,
      log: (m) => emit(`[pressrelease] ${m}`),
    });

    const finishedAt = new Date();
    const lu = pr?.data?.last_update ? new Date(pr.data.last_update) : finishedAt;
    const lastUpdate = !Number.isNaN(lu.getTime()) ? lu : finishedAt;

    const productionOk = pr?.production?.ok === true;
    const productionSkipped = pr?.production?.skipped === true;
    const productionErr =
      typeof pr?.production?.error === 'string'
        ? pr.production.error
        : typeof pr?.production?.reason === 'string'
          ? pr.production.reason
          : null;

    const ok = productionOk && !productionSkipped && !productionErr;
    const replicationError = ok ? null : `Replication to data_bps failed: ${productionErr || 'unknown error'}`;
    if (replicationError) warn(replicationError);

    await cfg.update({
      last_pull_finished_at: finishedAt,
      last_bps_last_update: lastUpdate,
      last_signature: `pressrelease:${keyword}`,
      last_success_at: ok ? finishedAt : cfg.last_success_at,
      last_error: replicationError,
      updated_at: finishedAt,
    });

    info(ok ? 'Automation config updated: SUCCESS' : 'Automation config updated: FAILED');

    try {
      const joined = internalLogs.join('\n');
      const capped = joined.length > 50_000 ? joined.slice(joined.length - 50_000) : joined;
      await AutomationRunLog.create({
        source_id: id,
        mode,
        ok,
        started_at: startedAt,
        finished_at: finishedAt,
        error: replicationError,
        logs: capped,
        created_at: finishedAt,
      });
    } catch {
      // best-effort
    }

    return {
      skipped: false,
      signature: `pressrelease:${keyword}`,
      last_update: lastUpdate.toISOString(),
      replicated_bps_cache: false,
      replicated_bps_indicator: false,
      replicated_bps_keyword: productionOk,
      replication_attempted: true,
      ok,
      error: replicationError,
      tableName: pr?.production?.tableName || null,
      upserted: pr?.production?.upserted || null,
    };
  }

  let structured;
  let structuredForCache;
  let signature;
  let lastUpdate;
  let metrics;
  let periods;
  let tableRowsForReplication;

  if (dsType === 'dynamic') {
    // Full refresh: always all years available
    info('Full refresh: fetching all years available (all=true)');
    ({ structured, signature, lastUpdate, metrics, periods } = await buildMergedProcessed({
      sourceId: id,
      datasource: ds,
      thIds: [],
      useAll: true,
    }));
  } else if (dsType === 'interop') {
    info('Full refresh (interop): pulling years from data_period_map');

    // Safe improvement: in "smart" mode, attempt to refresh the period map first
    // by probing interop ketersediaan_tahun. This is append-only via upsert
    // and prevents missing new years (e.g., 2026) without manual edits.
    if (mode === 'smart') {
      info('Smart mode (interop): refreshing period map from ketersediaan_tahun (best-effort)');
      try {
        await generatePeriodMap(id);
      } catch (e) {
        warn(`Smart mode (interop): failed to refresh period map: ${e?.message || String(e)}`);
      }
    }

    let maps = await DataPeriod.findAll({ where: { source_id: id }, order: [['period_value', 'ASC']] });
    if (!maps.length) {
      info('Period map kosong. Auto-generate period map (interop) via auto-discover ketersediaan_tahun…');
      try {
        await generatePeriodMap(id);
      } catch (e) {
        const msg = e?.message || String(e);
        const err = new Error(`Gagal auto-generate period map interop: ${msg}`);
        err.status = Number(e?.status) || 400;
        throw err;
      }
      maps = await DataPeriod.findAll({ where: { source_id: id }, order: [['period_value', 'ASC']] });
      if (!maps.length) {
        const err = new Error('Period map masih kosong setelah auto-generate. Coba jalankan /period/generate/:id dan pastikan api_url interop valid.');
        err.status = 400;
        throw err;
      }
    }

    const yearList = maps.map((m) => String(m.period_value));
    info(`Interop years in map: ${yearList.length} (${yearList[0]}..${yearList[yearList.length - 1]})`);

    const tableData = [];
    const metricsSet = new Set();
    let luMax = null;

    for (const m of maps) {
      const year = String(m.period_value);
      const apiUrl = m.api_url_override || String(ds.api_url || '').replace('{period}', year);
      const apiResp = await fetchAPI(apiUrl, id);
      const processed = processInterop(apiResp);

      const rows = Array.isArray(processed?.data) ? processed.data : [];
      for (const r of rows) {
        const obj = { year, th_id: year, ...r };
        tableData.push(obj);
        Object.keys(r || {}).forEach((k) => {
          if (k !== 'year' && k !== 'month' && k !== 'th_id') metricsSet.add(k);
        });
      }

      const lu = toAcceptableDateOrNull(processed?.last_update);
      luMax = maxDate(luMax, lu);
    }

    metrics = Array.from(metricsSet);
    lastUpdate = luMax;
    signature = 'all';
    periods = maps.map((m) => ({ th_id: String(m.period_value), year: String(m.period_value) }));

    structured = {
      source: { id, name: ds.name || null },
      metrics,
      years: periods.map((p) => ({
        year: p.year,
        th_id: p.th_id,
        months: tableData
          .filter((r) => String(r.year) === String(p.year))
          .map((r) => ({
            values: metrics.reduce((acc, k) => {
              acc[k] = r[k] ?? null;
              return acc;
            }, {}),
          })),
      })),
      last_update: toISOStringSafe(lastUpdate),
      table: {
        columns: [{ key: 'year', label: 'Tahun' }, ...metrics.map((m) => ({ key: m, label: m }))],
        data: tableData,
      },
    };
  } else if (dsType === 'static') {
    info('Full refresh (static): pulling once (no period)');
    const apiResp = await fetchAPI(String(ds.api_url || ''), id);
    const processed = processStatic(apiResp);

    const cols = Array.isArray(processed?.columns) ? processed.columns : [];
    const rows = Array.isArray(processed?.data) ? processed.data : [];

    metrics = cols;
    lastUpdate = toAcceptableDateOrNull(processed?.last_update);
    signature = 'static';
    periods = [{ th_id: 'static', year: '0' }];

    const tableData = rows.map((r) => ({ year: '0', th_id: 'static', ...r }));

    structured = {
      source: { id, name: ds.name || null },
      metrics,
      years: [{ year: '0', th_id: 'static', months: rows.map((r) => ({ values: r })) }],
      last_update: toISOStringSafe(lastUpdate),
      table: {
        columns: [{ key: 'year', label: 'Tahun' }, ...metrics.map((m) => ({ key: m, label: m }))],
        data: tableData,
      },
    };
  } else if (dsType === 'exim') {
    const isMaster = String(ds.api_url || '').includes('{code_hs}');
    const startYear = 2020;

    const isEkspor = String(ds.api_url || '').includes('/sumber/1/');
    const isImpor = String(ds.api_url || '').includes('/sumber/2/');
    const variantKey = isEkspor ? 'ekspor' : isImpor ? 'impor' : 'exim';

    if (isMaster) {
      const { HS2_GROUPS } = require('../exim/eximSeed.service');
      if (mode === 'smart') {
        info(`Smart mode (exim master:${variantKey}): probing years from ${startYear} until first empty year, then refreshing latest active year only`);

        const maxProbeYear = new Date().getFullYear() + 1;
        const latestActiveYear = await findLatestActiveEximYearMasterByProbing({
          ds,
          sourceId: id,
          hs2Groups: HS2_GROUPS,
          startYear,
          maxProbeYear,
        });

        if (!latestActiveYear) {
          info('No EXIM year found with data; skipping');
          const finishedAt = new Date();
          await cfg.update({
            last_pull_finished_at: finishedAt,
            last_signature: `exim:${variantKey}:all`,
            last_success_at: finishedAt,
            last_error: null,
            updated_at: finishedAt,
          });

          try {
            const joined = internalLogs.join('\n');
            const capped = joined.length > 50_000 ? joined.slice(joined.length - 50_000) : joined;
            await AutomationRunLog.create({
              source_id: id,
              mode,
              ok: true,
              started_at: startedAt,
              finished_at: finishedAt,
              error: null,
              logs: capped,
              created_at: finishedAt,
            });
          } catch {
            // best-effort
          }

          return { ok: true, skipped: true, reason: 'No EXIM data found' };
        }

        info(`Latest active year detected: ${latestActiveYear}`);

        metrics = ['value', 'netweight'];
        signature = `exim:${variantKey}:all`;
        lastUpdate = null;
        periods = [{ th_id: String(latestActiveYear), year: String(latestActiveYear) }];

        const toMonthNo = (raw) => {
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        };

        const detailedRows = [];
        for (const g of HS2_GROUPS) {
          const url = buildEximUrl(ds, latestActiveYear, g.code);
          const raw = await fetchAPI(url, id);
          if (!responseHasData(raw)) continue;

          const processed = processExim(raw, { year: String(latestActiveYear) });
          const lu = toAcceptableDateOrNull(processed?.last_update);
          lastUpdate = maxDate(lastUpdate, lu);

          if (Array.isArray(processed?.data)) {
            for (const r of processed.data) {
              detailedRows.push({
                year: String(latestActiveYear),
                month: r.Bulan,
                hs2: g.code,
                hs2_name: g.name,
                pod: r.pod ?? null,
                ctr: r.ctr ?? null,
                kodehs: r.kodehs ?? null,
                value: r.value ?? null,
                netweight: r.netweight ?? null,
                th_id: String(latestActiveYear),
                month_no: toMonthNo(r.month_no),
              });
            }
          }
        }

        const detailedTableData = detailedRows
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

        // Merge into existing cached preview (best-effort)
        let mergedTableData = detailedTableData;
        const existing = await MergedCache.findOne({ where: { source_id: id, signature } });
        const parsed = tryParseMergedJson(existing?.merged_json);
        const existingRows = Array.isArray(parsed?.table?.data) ? parsed.table.data : [];
        if (existingRows.length) {
          const kept = existingRows.filter((r) => String(r?.year) !== String(latestActiveYear));
          mergedTableData = [...kept, ...detailedTableData];
        }

        structured = {
          source: { id, name: ds.name || null },
          metrics,
          years: [],
          last_update: toISOStringSafe(lastUpdate),
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
            data: mergedTableData,
          },
        };

        tableRowsForReplication = detailedTableData;
        structuredForCache = buildMergedCachePreviewTail(structured, { maxRows: 2000 });
      } else {
        info(`Full refresh (exim master:${variantKey}): looping HS2 list and discovering latest available years (>=${startYear})`);

        metrics = ['value', 'netweight'];
        signature = `exim:${variantKey}:all`;
        lastUpdate = null;
        periods = [];

      const toMonthNo = (raw) => {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };

      const detailedRows = [];
      const yearSet = new Set();

      for (const g of HS2_GROUPS) {
        const latestYear = await findLatestAvailableEximYear({ ds, sourceId: id, codeHs: g.code, startYear });
        if (!latestYear) continue;

        for (let year = startYear; year <= latestYear; year++) {
          const url = buildEximUrl(ds, year, g.code);
          const raw = await fetchAPI(url, id);
          if (!responseHasData(raw)) continue;

          const processed = processExim(raw, { year: String(year) });
          const lu = toAcceptableDateOrNull(processed?.last_update);
          lastUpdate = maxDate(lastUpdate, lu);

          yearSet.add(String(year));

          if (Array.isArray(processed?.data)) {
            for (const r of processed.data) {
              detailedRows.push({
                year: String(year),
                month: r.Bulan,
                hs2: g.code,
                hs2_name: g.name,
                pod: r.pod ?? null,
                ctr: r.ctr ?? null,
                kodehs: r.kodehs ?? null,
                value: r.value ?? null,
                netweight: r.netweight ?? null,
                th_id: String(year),
                month_no: toMonthNo(r.month_no),
              });
            }
          }
        }
      }

      periods = Array.from(yearSet).sort().map((y) => ({ th_id: y, year: y }));

      const detailedTableData = detailedRows
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

      structured = {
        source: { id, name: ds.name || null },
        metrics,
        years: [],
        last_update: toISOStringSafe(lastUpdate),
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
          data: detailedTableData,
        },
      };

        tableRowsForReplication = detailedTableData;
        structuredForCache = buildMergedCachePreviewTail(structured, { maxRows: 2000 });
      }
    } else {
      const codeHs = null; // per-datasource HS baked in api_url
      if (mode === 'smart') {
        info(`Smart mode (exim:${variantKey}): probing years from ${startYear} until first empty year, then refreshing latest active year only`);

        const maxProbeYear = new Date().getFullYear() + 1;
        const latestActiveYear = await findLatestActiveEximYearByProbing({ ds, sourceId: id, startYear, maxProbeYear, codeHs });
        signature = `exim:${variantKey}`;
        metrics = ['value', 'netweight'];
        lastUpdate = null;
        periods = latestActiveYear ? [{ th_id: String(latestActiveYear), year: String(latestActiveYear) }] : [];

        if (!latestActiveYear) {
          structured = {
            source: { id, name: ds.name || null },
            metrics: [],
            years: [],
            last_update: toISOStringSafe(lastUpdate),
            table: {
              columns: [{ key: 'year', label: 'Tahun' }, { key: 'month', label: 'Bulan' }],
              data: [],
            },
          };
          structuredForCache = structured;
        } else {
          info(`Latest active year detected: ${latestActiveYear}`);

          const toMonthNo = (raw) => {
            const n = Number(raw);
            return Number.isFinite(n) ? n : null;
          };

          const url = buildEximUrl(ds, latestActiveYear, codeHs);
          const raw = await fetchAPI(url, id);
          const processed = responseHasData(raw) ? processExim(raw, { year: String(latestActiveYear) }) : null;
          lastUpdate = toAcceptableDateOrNull(processed?.last_update);

          const rows = [];
          if (Array.isArray(processed?.data)) {
            for (const r of processed.data) {
              rows.push({
                year: String(latestActiveYear),
                month: r.Bulan,
                pod: r.pod ?? null,
                ctr: r.ctr ?? null,
                kodehs: r.kodehs ?? null,
                value: r.value ?? null,
                netweight: r.netweight ?? null,
                th_id: String(latestActiveYear),
                month_no: toMonthNo(r.month_no),
              });
            }
          }

          const detailedTableData = rows
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

          let mergedTableData = detailedTableData;
          const existing = await MergedCache.findOne({ where: { source_id: id, signature } });
          const parsed = tryParseMergedJson(existing?.merged_json);
          const existingRows = Array.isArray(parsed?.table?.data) ? parsed.table.data : [];
          if (existingRows.length) {
            const kept = existingRows.filter((r) => String(r?.year) !== String(latestActiveYear));
            mergedTableData = [...kept, ...detailedTableData];
          }

          structured = {
            source: { id, name: ds.name || null },
            metrics,
            years: [],
            last_update: toISOStringSafe(lastUpdate),
            table: {
              columns: [
                { key: 'year', label: 'Tahun' },
                { key: 'month', label: 'Bulan' },
                { key: 'pod', label: 'POD' },
                { key: 'ctr', label: 'CTR' },
                { key: 'kodehs', label: 'Kode HS' },
                ...metrics.map((m) => ({ key: m, label: m })),
              ],
              data: mergedTableData,
            },
          };

          tableRowsForReplication = detailedTableData;
          structuredForCache = structured;
        }
      } else {
        info('Full refresh (exim): discovering latest available year (>=2020)');

        const latestYear = await findLatestAvailableEximYear({ ds, sourceId: id, codeHs });
      if (!latestYear) {
        metrics = [];
        lastUpdate = null;
        signature = `exim:${variantKey}`;
        periods = [];
        structured = {
          source: { id, name: ds.name || null },
          metrics,
          years: [],
          last_update: toISOStringSafe(lastUpdate),
          table: {
            columns: [{ key: 'year', label: 'Tahun' }, { key: 'month', label: 'Bulan' }],
            data: [],
          },
        };
      } else {
        const processedList = [];
        let luMax = null;

        for (let year = startYear; year <= latestYear; year++) {
          const url = buildEximUrl(ds, year, codeHs);
          const raw = await fetchAPI(url, id);
          if (!responseHasData(raw)) continue;
          const processed = processExim(raw, { year: String(year) });
          processedList.push({ year: String(year), processed });
          const lu = toAcceptableDateOrNull(processed?.last_update);
          luMax = maxDate(luMax, lu);
        }

        const rows = [];
        for (const item of processedList) {
          const p = item.processed;
          if (Array.isArray(p?.data)) {
            p.data.forEach((row) => rows.push({ ...row, year: item.year, th_id: item.year }));
          }
        }

        metrics = ['value', 'netweight'];
        lastUpdate = luMax;
        signature = `exim:${variantKey}`;
        periods = processedList.map((p) => ({ th_id: p.year, year: p.year }));

        const detailedTableData = rows
          .map((r) => ({
            year: String(r.year),
            month: r.Bulan,
            pod: r.pod ?? null,
            ctr: r.ctr ?? null,
            kodehs: r.kodehs ?? null,
            value: r.value ?? null,
            netweight: r.netweight ?? null,
            th_id: String(r.th_id),
            month_no: toMonthNo(r.month_no),
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

        structured = {
          source: { id, name: ds.name || null },
          metrics,
          years: [],
          last_update: toISOStringSafe(lastUpdate),
          table: {
            columns: [
              { key: 'year', label: 'Tahun' },
              { key: 'month', label: 'Bulan' },
              { key: 'pod', label: 'POD' },
              { key: 'ctr', label: 'CTR' },
              { key: 'kodehs', label: 'Kode HS' },
              ...metrics.map((m) => ({ key: m, label: m })),
            ],
            data: detailedTableData,
          },
        };

        tableRowsForReplication = detailedTableData;
        structuredForCache = structured;
      }
      }
    }
  } else {
    const err = new Error(`Automation belum mendukung type=${dsType}`);
    err.status = 400;
    throw err;
  }

  // Normalize last_update: never allow epoch; prefer previous cache's last_update.
  {
    const finishedAt = new Date();
    const effectiveLastUpdate = await resolveLastUpdateFallback({
      sourceId: id,
      signature: signature || 'all',
      candidate: lastUpdate,
      finishedAt,
    });

    lastUpdate = effectiveLastUpdate;

    if (structured && typeof structured === 'object') {
      structured.last_update = lastUpdate.toISOString();
    }
    if (structuredForCache && typeof structuredForCache === 'object') {
      structuredForCache.last_update = lastUpdate.toISOString();
    }
  }

  info(`Available periods count: ${periods?.length || 0}`);
  info(`Merged signature: ${signature}`);
  info(`Merged last_update: ${lastUpdate.toISOString()}`);
  info(`Metrics count: ${metrics?.length || 0}`);

  // Persist to primary
  await MergedCache.upsert({
    source_id: id,
    signature: signature || 'all',
    merged_json: JSON.stringify(structuredForCache || structured),
    last_update: new Date(lastUpdate.toISOString()),
    updated_at: new Date(),
  });

  // Best-effort: index merged table columns + categorical values into search terms.
  try {
    const table = structured?.table || structuredForCache?.table || null;
    if (table) {
      await syncMetadataIndexForTable({ sourceId: id, table });
    }
  } catch {
    // ignore
  }

  info(`Saved primary: project_data_strategis.data_merged_cache (signature=${signature || 'all'})`);

  // Replicate to data_bps (cache + per-indicator table)
  let replicated_bps_cache = false;
  let replicated_bps_indicator = false;
  let replicationAttempted = false;
  let replicationError = null;
  try {
    const getSequelizeBps = require('../../config/db_bps');
    const getMergedCacheBpsModel = require('../../models_bps/MergedCacheBps.model');
    const sequelizeBps = getSequelizeBps();
    const MergedCacheBps = getMergedCacheBpsModel();
    if (sequelizeBps && MergedCacheBps) {
      replicationAttempted = true;
      info('Replicating to data_bps...');
      await sequelizeBps.authenticate();
      await sequelizeBps.sync();
      await MergedCacheBps.upsert({
        source_id: id,
        signature: signature || 'all',
        merged_json: JSON.stringify(structuredForCache || structured),
        last_update: new Date(lastUpdate.toISOString()),
        updated_at: new Date(),
      });
      replicated_bps_cache = true;
      info(`Saved replica: data_bps.data_merged_cache (signature=${signature || 'all'})`);

      const { replicateMergedToIndicatorTableBps } = require('../replication/indicatorTableBps.service');
      const eximPodAllowlist = String(signature || '').startsWith('exim:') ? await getEximPodAllowlist(id) : [];
      await replicateMergedToIndicatorTableBps({
        sequelizeBps,
        source: structured.source,
        signature: signature || 'all',
        metrics,
        tableRows: tableRowsForReplication || structured.table.data,
        lastUpdate: lastUpdate.toISOString(),
        log: (line) => internalLogs.push(String(line)),
        podAllowlist: eximPodAllowlist,
      });
      replicated_bps_indicator = true;
      info(`Upserted production table: data_bps.indikator_${id}`);
    }
  } catch (e) {
    // Replication failure should mark the run as FAILED in the UI.
    replicationError = `Replication to data_bps failed: ${e?.message || String(e)}`;
    warn(replicationError);
  }

  const finishedAt = new Date();
  const ok = !replicationError;

  await cfg.update({
    last_pull_finished_at: finishedAt,
    last_bps_last_update: new Date(lastUpdate.toISOString()),
    last_signature: signature || 'all',
    last_success_at: ok ? finishedAt : cfg.last_success_at,
    last_error: replicationError,
    updated_at: finishedAt,
  });

  info(ok ? 'Automation config updated: SUCCESS' : 'Automation config updated: FAILED');

  // Persist last run logs (success or failure)
  try {
    const joined = internalLogs.join('\n');
    const capped = joined.length > 50_000 ? joined.slice(joined.length - 50_000) : joined;
    await AutomationRunLog.create({
      source_id: id,
      mode,
      ok,
      started_at: startedAt,
      finished_at: finishedAt,
      error: replicationError,
      logs: capped,
      created_at: finishedAt,
    });
  } catch {
    // best-effort
  }

  return {
    skipped: false,
    signature,
    last_update: lastUpdate.toISOString(),
    replicated_bps_cache,
    replicated_bps_indicator,
    replication_attempted: replicationAttempted,
    ok,
    error: replicationError,
  };
  } finally {
    inFlightSourceIds.delete(id);
  }
}

module.exports = {
  runAutomationForSource,
};
