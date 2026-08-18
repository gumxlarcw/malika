const DataSource = require("../models/DataSource.model");
const { buildMergedProcessed } = require("../services/merge/mergeBuilder.service");
const processExim = require("../services/processor/exim.processor");
const { buildEximUrl, responseHasData, findLatestAvailableEximYear } = require("../services/exim/eximYearDiscovery.service");
const { fetchAPI } = require("../services/datasource/fetch.service");

const MONTH_ORDER = [
  'Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'
];

// Merge multiple processed JSONs for a datasource across th_ids
async function mergeProcessedByTh(req, res) {
  try {
    const id = Number(req.params.id);
    const ds = await DataSource.findByPk(id);
    if (!ds) return res.status(404).json({ message: "DataSource not found" });

    const dsType = String(ds.type || 'dynamic').toLowerCase();

    // EXIM: merge by year (2020..latest available), not BPS th_id
    if (dsType === 'exim') {
      const codeHs = req.query.code_hs ? String(req.query.code_hs) : undefined;
      const latestYear = await findLatestAvailableEximYear({ ds, sourceId: id, codeHs });

      if (!latestYear) {
        const structuredEmpty = {
          source: { id, name: ds.name || null },
          metrics: [],
          years: [],
          last_update: new Date(0).toISOString(),
          table: { columns: [{ key: 'year', label: 'Tahun' }, { key: 'month', label: 'Bulan' }], data: [] },
        };

        return res.json(structuredEmpty);
      }

      const startYear = 2020;
      const processedList = [];
      let lastUpdate = new Date(0);

      for (let year = startYear; year <= latestYear; year++) {
        const url = buildEximUrl(ds, year, codeHs);
        const raw = await fetchAPI(url, id);
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
          p.data.forEach((row) => rows.push({ ...row, year: item.year, th_id: item.year }));
        }
      }

      const metricsSet = new Set();
      for (const r of rows) {
        Object.keys(r || {}).forEach((k) => {
          if (k !== 'Bulan' && k !== 'year' && k !== 'th_id') metricsSet.add(k);
        });
      }
      const metrics = Array.from(metricsSet);

      const yearGroups = new Map();
      for (const r of rows) {
        const y = String(r.year);
        if (!yearGroups.has(y)) yearGroups.set(y, []);
        yearGroups.get(y).push(r);
      }

      const years = Array.from(yearGroups.entries())
        .map(([year, items]) => ({
          year,
          th_id: year,
          months: items.map((it) => ({
            name: it.Bulan,
            values: metrics.reduce((acc, m) => {
              acc[m] = it[m] ?? null;
              return acc;
            }, {}),
          })),
        }))
        .sort((a, b) => String(a.year).localeCompare(String(b.year)));

      const tableColumns = [
        { key: 'year', label: 'Tahun' },
        { key: 'month', label: 'Bulan' },
        ...metrics.map((m) => ({ key: m, label: m })),
      ];

      const tableRows = years.flatMap((y) =>
        y.months.map((m) => ({
          year: y.year,
          month: m.name,
          ...m.values,
          th_id: y.th_id,
        }))
      );

      tableRows.sort((a, b) => {
        const yc = String(a.year).localeCompare(String(b.year));
        if (yc !== 0) return yc;
        return MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month);
      });

      const structured = {
        source: { id, name: ds.name || null },
        metrics,
        years,
        last_update: lastUpdate.toISOString(),
        table: {
          columns: tableColumns,
          data: tableRows,
        },
      };

      // Keep signature stable for EXIM requests
      const signature = codeHs ? `exim:${codeHs}` : 'exim';

      let meta = null;
      if (String(req.query.save || '') === 'true') {
        const saveSignature = signature;

        meta = {
          signature: saveSignature,
          saved_primary: false,
          replicated_bps_cache: false,
          replicated_bps_indicator: false,
          indicator_table: `indikator_${id}`,
        };

        const MergedCache = require('../models/MergedCache.model');
        await MergedCache.upsert({
          source_id: id,
          signature: saveSignature,
          merged_json: JSON.stringify(structured),
          last_update: new Date(lastUpdate.toISOString()),
          updated_at: new Date(),
        });
        meta.saved_primary = true;

        try {
          const getSequelizeBps = require('../config/db_bps');
          const getMergedCacheBpsModel = require('../models_bps/MergedCacheBps.model');
          const sequelizeBps = getSequelizeBps();
          const MergedCacheBps = getMergedCacheBpsModel();
          if (sequelizeBps && MergedCacheBps) {
            await sequelizeBps.authenticate();
            await sequelizeBps.sync();
            await MergedCacheBps.upsert({
              source_id: id,
              signature: saveSignature,
              merged_json: JSON.stringify(structured),
              last_update: new Date(lastUpdate.toISOString()),
              updated_at: new Date(),
            });
            meta.replicated_bps_cache = true;

            const { replicateMergedToIndicatorTableBps } = require('../services/replication/indicatorTableBps.service');
            await replicateMergedToIndicatorTableBps({
              sequelizeBps,
              source: structured.source,
              signature: saveSignature,
              metrics,
              tableRows: structured.table.data,
              lastUpdate: lastUpdate.toISOString(),
            });
            meta.replicated_bps_indicator = true;
          }
        } catch (repErr) {
          console.warn('[replicate:data_bps] failed:', repErr?.message);
        }
      }

      return res.json(meta ? { ...structured, meta } : structured);
    }
    const thIdsParam = String(req.query.th_ids || "").trim();
    let thIds = thIdsParam ? thIdsParam.split(",").map(s => s.trim()).filter(Boolean) : [];
    const useAll = String(req.query.all || "") === "true";
    const { structured, signature, lastUpdate, metrics } = await buildMergedProcessed({
      sourceId: id,
      datasource: ds,
      thIds,
      useAll,
    });

    let meta = null;
    // Optionally persist to merged cache if save=true
    if (String(req.query.save || '') === 'true') {
      const saveSignature = (!thIdsParam && useAll) ? 'all' : (signature || 'all');

      meta = {
        signature: saveSignature,
        saved_primary: false,
        replicated_bps_cache: false,
        replicated_bps_indicator: false,
        indicator_table: `indikator_${id}`,
      };

      const MergedCache = require('../models/MergedCache.model');
      await MergedCache.upsert({
        source_id: id,
        signature: saveSignature,
        merged_json: JSON.stringify(structured),
        last_update: new Date(lastUpdate.toISOString()),
        updated_at: new Date(),
      });
      meta.saved_primary = true;

      // Create a notification (best-effort)
      try {
        const { createNotification } = require('../services/notification/notification.service');
        const indicatorName = (ds && ds.name) ? String(ds.name).trim() : null;
        await createNotification({
          uniqueKey: `merged:${id}:${saveSignature}:${lastUpdate.toISOString()}`,
          type: 'data',
          title: 'Data Statistik',
          message: indicatorName ? `${indicatorName} diperbarui` : 'Data Statistik diperbarui',
          link: '/',
          metadata: { source_id: id, signature: saveSignature, last_update: lastUpdate.toISOString() },
          createdAt: lastUpdate,
        });
      } catch {
        // best-effort
      }

      // Replicate to data_bps if configured
      try {
        const getSequelizeBps = require('../config/db_bps');
        const getMergedCacheBpsModel = require('../models_bps/MergedCacheBps.model');
        const sequelizeBps = getSequelizeBps();
        const MergedCacheBps = getMergedCacheBpsModel();
        if (sequelizeBps && MergedCacheBps) {
          await sequelizeBps.authenticate();
          await sequelizeBps.sync();
          await MergedCacheBps.upsert({
            source_id: id,
            signature: saveSignature,
            merged_json: JSON.stringify(structured),
            last_update: new Date(lastUpdate.toISOString()),
            updated_at: new Date(),
          });
          meta.replicated_bps_cache = true;

          // Also replicate into a per-indicator table for dashboard consumers
          const { replicateMergedToIndicatorTableBps } = require('../services/replication/indicatorTableBps.service');
          await replicateMergedToIndicatorTableBps({
            sequelizeBps,
            source: structured.source,
            signature: saveSignature,
            metrics,
            tableRows: structured.table.data,
            lastUpdate: lastUpdate.toISOString(),
          });
          meta.replicated_bps_indicator = true;
        }
      } catch (repErr) {
        // log but do not fail the main request
        console.warn('[replicate:data_bps] failed:', repErr?.message);
      }
    }
    res.json(meta ? { ...structured, meta } : structured);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to merge processed by th" });
  }
}

module.exports = { mergeProcessedByTh };
// Read a saved merged cache from primary or BPS DB
async function readSavedMerged(req, res) {
  try {
    const id = Number(req.params.id);
    const signature = String(req.query.signature || 'all');
    const MergedCache = require('../models/MergedCache.model');
    const row = await MergedCache.findOne({ where: { source_id: id, signature } });
    if (!row) return res.status(404).json({ message: 'Merged cache not found' });
    let payload;
    try { payload = JSON.parse(row.merged_json); } catch { payload = row.merged_json; }
    res.json({ signature, updated_at: row.updated_at || row.last_update, payload });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to read merged cache' });
  }
}

module.exports.readSavedMerged = readSavedMerged;
