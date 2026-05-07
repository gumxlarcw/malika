const { fetchAPI } = require("../services/datasource/fetch.service");
const processExim = require("../services/processor/exim.processor");
const { getCache, saveCache } = require("../services/cache/cache.service");
const { buildEximUrl } = require("../services/exim/eximYearDiscovery.service");
const { getHs2IndonesianName } = require("../services/exim/hs2Lookup.service");
const { buildEximAllHs2Summary } = require("../services/exim/eximAllHs2Summary.service");
const { readEximFromBps } = require("../services/bpsRead/indicatorTableRead.service");
const DataSource = require("../models/DataSource.model");
const sequelize = require("../config/db");
const getSequelizeBps = require("../config/db_bps");

async function enrichEximHsDescription(processed, codeHs) {
  try {
    const rows = Array.isArray(processed?.data) ? processed.data : [];
    if (rows.length === 0) return { processed, changed: false };

    const hsFromQuery = codeHs ? String(codeHs).trim().padStart(2, '0') : null;
    const hsNameFromQuery = hsFromQuery ? await getHs2IndonesianName(hsFromQuery) : null;

    let changed = false;
    for (const r of rows) {
      const rawKode = typeof r?.kodehs === 'string' ? r.kodehs : '';
      if (!rawKode) continue;

      const m = rawKode.match(/\[(\d{1,2})\]\s*(.*)$/);
      const hs2 = m ? String(m[1]).padStart(2, '0') : (hsFromQuery || null);
      if (!hs2) continue;

      const hs2Name = hs2 === hsFromQuery && hsNameFromQuery
        ? hsNameFromQuery
        : await getHs2IndonesianName(hs2);

      if (!hs2Name) continue;
      const nextKode = `[${hs2}] ${hs2Name}`;
      if (nextKode !== rawKode) {
        r.kodehs = nextKode;
        changed = true;
      }
    }

    return { processed, changed };
  } catch {
    return { processed, changed: false };
  }
}

exports.getExim = async (req, res) => {
  try {
    const source_id = req.params.id;

    const yearRaw = req.query.year ?? req.query.period;
    const year = String(Array.isArray(yearRaw) ? yearRaw[0] : yearRaw || "").trim();
    if (!year) return res.status(400).json({ message: "Parameter year/period wajib diisi." });

    const codeHsRaw = req.query.code_hs ?? req.query.codeHs ?? req.query.codehs;
    const codeHs = String(Array.isArray(codeHsRaw) ? codeHsRaw[0] : codeHsRaw || "").trim() || null;

    const podRaw = req.query.pod;
    const ctrRaw = req.query.ctr;

    const normalizeGenericFilterToken = (token, kind) => {
      const raw = String(token || '').trim();
      if (!raw) return '';

      const t = raw.toLowerCase();
      // Guardrail: query builders (and users) sometimes include dimension keywords as filter values
      // e.g. "menurut pelabuhan" -> pod="pelabuhan". Treat these as "no filter".
      const generic = new Set([
        ...(kind === 'pod' ? ['pod', 'pelabuhan', 'port'] : []),
        ...(kind === 'ctr' ? ['ctr', 'negara', 'country'] : []),
      ]);
      if (generic.has(t)) return '';

      return raw;
    };

    const podQuery = normalizeGenericFilterToken(Array.isArray(podRaw) ? podRaw[0] : podRaw, 'pod');
    const ctrQuery = normalizeGenericFilterToken(Array.isArray(ctrRaw) ? ctrRaw[0] : ctrRaw, 'ctr');

    const metricRaw = req.query.metric;
    const metric = String(Array.isArray(metricRaw) ? metricRaw[0] : metricRaw || '')
      .trim()
      .toLowerCase();
    const metricWanted =
      metric === 'value' || metric === 'nilai'
        ? 'value'
        : metric === 'netweight' || metric === 'volume' || metric === 'berat' || metric === 'netto' || metric === 'berat bersih'
          ? 'netweight'
          : null;

    const groupRaw = req.query.group ?? req.query.by;
    const groupBy = String(Array.isArray(groupRaw) ? groupRaw[0] : groupRaw || '').trim().toLowerCase();
    const groupWanted = (() => {
      if (!groupBy) return null;
      if (groupBy === 'hs2') return 'hs2';
      if (groupBy === 'pod' || groupBy === 'pelabuhan' || groupBy === 'port') return 'pod';
      if (groupBy === 'ctr' || groupBy === 'negara' || groupBy === 'country') return 'ctr';
      if (groupBy === 'detail') return 'detail';
      if (groupBy === 'hs2ctr') return 'hs2ctr';
      if (groupBy === 'hs2pod') return 'hs2pod';
      return null;
    })();

    const monthRaw = req.query.month ?? req.query.month_no ?? req.query.monthNo;
    const monthStr = String(Array.isArray(monthRaw) ? monthRaw[0] : monthRaw || '').trim();
    const monthNo = monthStr ? Number(monthStr) : null;
    const wantMonth = Number.isFinite(monthNo) && monthNo >= 1 && monthNo <= 12;

    const wantPod = podQuery.length >= 2;
    const wantCtr = ctrQuery.length >= 2;

    const source = await DataSource.findByPk(source_id);
    if (!source) return res.status(404).json({ message: "Source not found" });
    if (String(source.type || "") !== "exim") {
      return res.status(400).json({ message: "Source bukan EXIM" });
    }

    // Enforce read-only data_bps (metabase-safe) to avoid showing nationwide upstream data.
    const sequelizeBps = getSequelizeBps();
    if (!sequelizeBps) {
      return res.status(503).json({
        message: "DB data_bps belum dikonfigurasi (DB_BPS_USER/DB_BPS_PASS). Endpoint ini hanya melayani data dari data_bps.",
        code: "DB_BPS_DISABLED",
      });
    }

    const bpsData = await readEximFromBps({
      sourceId: source_id,
      year,
      monthNo: wantMonth ? monthNo : null,
      hs2: codeHs,
      pod: podQuery,
      ctr: ctrQuery,
      metricWanted,
      groupBy: groupWanted,
    });

    if (bpsData) {
      return res.json({
        cached: true,
        updated: false,
        data: bpsData,
      });
    }

    return res.status(404).json({
      message: "Data indikator EXIM belum tersedia di data_bps (belum direplikasi).",
      code: "DATA_BPS_NOT_AVAILABLE",
    });

    const isMaster = String(source.api_url || '').includes('{code_hs}');
    if (isMaster && !codeHs) {
      const cachePeriod = `${year}|ALL`;
      const cache = await getCache(source_id, cachePeriod);
      if (cache) {
        const oldData = JSON.parse(cache.processed_json);

        const rows = Array.isArray(oldData?.data) ? oldData.data : [];
        const filteredRows = rows.filter((r) => {
          if (wantMonth) return Number(r?.month_no) === Number(monthNo);
          return true;
        });

        const metricAppliedRows = metricWanted
          ? filteredRows.map((r) => {
            const next = { ...r };
            if (metricWanted === 'value') delete next.netweight;
            if (metricWanted === 'netweight') delete next.value;
            return next;
          })
          : filteredRows;

        const nextColumns = Array.isArray(oldData?.columns)
          ? oldData.columns.filter((c) => {
            if (!metricWanted) return true;
            if (metricWanted === 'value') return String(c) !== 'netweight';
            if (metricWanted === 'netweight') return String(c) !== 'value';
            return true;
          })
          : oldData?.columns;

        return res.json({
          cached: true,
          updated: false,
          data: {
            ...oldData,
            columns: nextColumns,
            data: metricAppliedRows,
          },
        });
      }

      const summary = await buildEximAllHs2Summary({ source, sourceId: source_id, year });
      await saveCache(source_id, cachePeriod, summary);

      const rows = Array.isArray(summary?.data) ? summary.data : [];
      const filteredRows = rows.filter((r) => {
        if (wantMonth) return Number(r?.month_no) === Number(monthNo);
        return true;
      });

      const metricAppliedRows = metricWanted
        ? filteredRows.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
        : filteredRows;

      const nextColumns = Array.isArray(summary?.columns)
        ? summary.columns.filter((c) => {
          if (!metricWanted) return true;
          if (metricWanted === 'value') return String(c) !== 'netweight';
          if (metricWanted === 'netweight') return String(c) !== 'value';
          return true;
        })
        : summary?.columns;

      return res.json({
        cached: false,
        updated: false,
        data: {
          ...summary,
          columns: nextColumns,
          data: metricAppliedRows,
        },
      });
    }

    const apiUrl = buildEximUrl(source, year, codeHs);
    const cachePeriod = codeHs ? `${year}|${codeHs}` : year;

    const cache = await getCache(source_id, cachePeriod);
    if (cache) {
      const oldData = JSON.parse(cache.processed_json);

      const enriched = await enrichEximHsDescription(oldData, codeHs);
      if (enriched.changed) {
        try {
          await saveCache(source_id, cachePeriod, enriched.processed);
        } catch {
          // Best-effort only.
        }
      }
      const rows = Array.isArray(enriched.processed?.data) ? enriched.processed.data : [];
      const filteredRows = rows
        .filter((r) => {
          if (wantMonth) return Number(r?.month_no) === Number(monthNo);
          return true;
        })
        .filter((r) => {
          if (!(wantPod || wantCtr)) return true;
          const pod = String(r?.pod || '').toLowerCase();
          const ctr = String(r?.ctr || '').toLowerCase();
          if (wantPod && !pod.includes(podQuery.toLowerCase())) return false;
          if (wantCtr && !ctr.includes(ctrQuery.toLowerCase())) return false;
          return true;
        });

      const metricAppliedRows = metricWanted
        ? filteredRows.map((r) => {
          const next = { ...r };
          if (metricWanted === 'value') delete next.netweight;
          if (metricWanted === 'netweight') delete next.value;
          return next;
        })
        : filteredRows;

      const nextColumns = Array.isArray(enriched.processed?.columns)
        ? enriched.processed.columns.filter((c) => {
          if (!metricWanted) return true;
          if (metricWanted === 'value') return String(c) !== 'netweight';
          if (metricWanted === 'netweight') return String(c) !== 'value';
          return true;
        })
        : enriched.processed?.columns;

      return res.json({
        cached: true,
        updated: Boolean(enriched.changed),
        data: {
          ...enriched.processed,
          columns: nextColumns,
          data: metricAppliedRows,
        },
      });
    }

    const apiResponse = await fetchAPI(apiUrl, source_id);
    const processed = processExim(apiResponse, { year });
    const enriched = await enrichEximHsDescription(processed, codeHs);
    // Cache the enriched (but unfiltered) data
    await saveCache(source_id, cachePeriod, enriched.processed);

    const rows = Array.isArray(enriched.processed?.data) ? enriched.processed.data : [];
    const filteredRows = rows
      .filter((r) => {
        if (wantMonth) return Number(r?.month_no) === Number(monthNo);
        return true;
      })
      .filter((r) => {
        if (!(wantPod || wantCtr)) return true;
        const pod = String(r?.pod || '').toLowerCase();
        const ctr = String(r?.ctr || '').toLowerCase();
        if (wantPod && !pod.includes(podQuery.toLowerCase())) return false;
        if (wantCtr && !ctr.includes(ctrQuery.toLowerCase())) return false;
        return true;
      });

    const metricAppliedRows = metricWanted
      ? filteredRows.map((r) => {
        const next = { ...r };
        if (metricWanted === 'value') delete next.netweight;
        if (metricWanted === 'netweight') delete next.value;
        return next;
      })
      : filteredRows;

    const nextColumns = Array.isArray(enriched.processed?.columns)
      ? enriched.processed.columns.filter((c) => {
        if (!metricWanted) return true;
        if (metricWanted === 'value') return String(c) !== 'netweight';
        if (metricWanted === 'netweight') return String(c) !== 'value';
        return true;
      })
      : enriched.processed?.columns;

    return res.json({
      cached: false,
      updated: false,
      data: {
        ...enriched.processed,
        columns: nextColumns,
        data: metricAppliedRows,
      },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};

// GET /exim/hs2?q=nikel
// Best-effort helper so the public UI can map commodity words -> HS2 digit.
exports.searchHs2 = async (req, res) => {
  try {
    const qRaw = req.query.q;
    const q = String(Array.isArray(qRaw) ? qRaw[0] : qRaw || '').trim();
    if (!q || q.length < 2) return res.json({ items: [] });

    const qLower = q.toLowerCase();
    // Manual aliases for common Indonesian terms that don't appear in HS2 chapter wording.
    // - emas -> HS71 (precious metals)
    if (qLower === 'emas') {
      return res.json({
        items: [
          {
            hs2digit: '71',
            name: (await getHs2IndonesianName('71')) || 'Logam mulia (HS 71)',
          },
        ],
      });
    }

    // - nikel/nickel -> HS75
    if (qLower.includes('nikel') || qLower.includes('nickel')) {
      return res.json({
        items: [
          {
            hs2digit: '75',
            name: (await getHs2IndonesianName('75')) || 'Nikel dan barang daripadanya (HS 75)',
          },
        ],
      });
    }

    const like = `%${q}%`;
    const [rows] = await sequelize.query(
      "SELECT hs2digit, bab_ind, bab_ind_singkat, bab_eng FROM `data_bps`.`kodehs_indd` WHERE bab_ind LIKE ? OR bab_ind_singkat LIKE ? OR bab_eng LIKE ? ORDER BY hs2digit ASC LIMIT 25",
      { replacements: [like, like, like] }
    );

    const items = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const hs2digit = String(r?.hs2digit || '').trim();
        const name = String(r?.bab_ind_singkat || r?.bab_ind || r?.bab_eng || '').trim();
        return hs2digit && name ? { hs2digit, name } : null;
      })
      .filter(Boolean);

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
