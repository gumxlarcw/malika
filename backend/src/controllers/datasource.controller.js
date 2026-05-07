const DataSource = require("../models/DataSource.model");
const DataPeriod = require("../models/DataPeriod.model");
const ProcessedCache = require("../models/ProcessedCache.model");
const MergedCache = require("../models/MergedCache.model");
const sequelize = require("../config/db");
const DataSourceSearchTerm = require("../models/DataSourceSearchTerm.model");
const getSequelizeBps = require("../config/db_bps");
const { parseDatasourceUrl } = require("../services/datasource/parseDatasourceUrl.service");
const { seedEximDatasources } = require("../services/exim/eximSeed.service");
const { resolveBpsApiKey } = require("../services/pressrelease/apiKey.service");
const {
  rebuildTermsForSource,
  rebuildTermsForAllSources,
} = require("../services/search/searchTermSync.service");
const {
  reindexSearchMetadataFromCacheForSource,
  reindexSearchMetadataFromCacheForAll,
} = require('../services/search/metadataReindex.service');

function normalizeNameForMatch(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

async function applyWebApiKeyPlaceholder(rawUrl) {
  const url = String(rawUrl || "");
  if (!url.includes("[WebAPI_KEY]")) return url;

  const apiKey = await resolveBpsApiKey();
  if (!apiKey) {
    const err = new Error(
      'BPS API key belum dikonfigurasi. Set env BPS_API_KEY (disarankan) atau API_KEY. (URL mengandung placeholder "[WebAPI_KEY]")'
    );
    err.status = 400;
    throw err;
  }

  return url.replace(/\[WebAPI_KEY\]/g, apiKey);
}

exports.getAll = async (req, res) => {
  try {
    const list = await DataSource.findAll({
      where: { visible: 1 },
      order: [
        ["display_order", "ASC"],
        ["id", "ASC"],
      ],
      attributes: [
        "id",
        "name",
        "type",
        "icon",
        "color",
        "category",
        "compare_to",
        "visible",
        "display_order",
      ],
    });

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAdminList = async (req, res) => {
  try {
    const list = await DataSource.findAll({
      order: [
        ["display_order", "ASC"],
        ["id", "ASC"],
      ],
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.prepareFromUrl = async (req, res) => {
  try {
    const url = await applyWebApiKeyPlaceholder(String(req.body?.url || ""));
    const type = req.body?.type ? String(req.body.type) : undefined;
    const parsed = await parseDatasourceUrl({ url, type });
    res.json(parsed);
  } catch (err) {
    const status = Number(err?.status) || 500;
    res.status(status).json({ message: err.message || String(err) });
  }
};

exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date();

    const name = String(body.name || "").trim();
    const type = String(body.type || "").trim();
    const apiUrl = await applyWebApiKeyPlaceholder(String(body.api_url || "").trim());
    const force = Boolean(body.force);
    if (!name) return res.status(400).json({ message: "name wajib diisi" });
    if (!["dynamic", "static", "interop", "exim", "pressrelease"].includes(type)) {
      return res.status(400).json({ message: "type harus dynamic|static|interop|exim|pressrelease" });
    }
    // API URL wajib untuk semua type kecuali pressrelease
    if (type !== "pressrelease" && !apiUrl) {
      return res.status(400).json({ message: "api_url wajib diisi" });
    }

    // Warn on duplicate name (by exact normalized name). Client can bypass with force=true.
    if (!force) {
      const norm = normalizeNameForMatch(name);
      const existing = await DataSource.findAll({
        where: { name: norm },
        attributes: ["id", "name", "type", "visible", "status"],
        limit: 10,
      });

      if (existing && existing.length) {
        return res.status(409).json({
          ok: false,
          code: "DATASOURCE_NAME_EXISTS",
          message: "Datasource dengan nama yang sama sudah ada",
          matches: existing,
        });
      }
    }

    const row = await DataSource.create({
      name,
      description: body.description ?? null,
      aliases: body.aliases ?? null,
      type,
      api_url: apiUrl,
      period_key: body.period_key ?? null,
      summary_trend: body.summary_trend ?? null,
      auto_period: body.auto_period ?? false,
      status: body.status ?? true,
      visible: body.visible ?? true,
      display_order: Number.isFinite(Number(body.display_order)) ? Number(body.display_order) : 0,
      icon: body.icon ?? null,
      color: body.color ?? null,
      category: body.category ?? null,
      compare_to: body.compare_to ?? null,
      created_at: now,
      updated_at: now,
    });

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

// DELETE /datasource/:id/hard
// Admin-only, restricted: ONLY allow hard delete for datasource id=178.
exports.hardRemove = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });

  if (id !== 178) {
    return res.status(403).json({ message: "Hard delete hanya diizinkan untuk datasource id=178" });
  }

  try {
    const row = await DataSource.findByPk(id);
    if (!row) return res.status(404).json({ message: "Datasource not found" });

    await sequelize.transaction(async (t) => {
      await DataSourceSearchTerm.destroy({ where: { source_id: id }, transaction: t });
      await DataPeriod.destroy({ where: { source_id: id }, transaction: t });
      await ProcessedCache.destroy({ where: { source_id: id }, transaction: t });
      await MergedCache.destroy({ where: { source_id: id }, transaction: t });
      await row.destroy({ transaction: t });
    });

    // Best-effort cleanup in data_bps (Metabase DB): remove merged cache and indikator_178 if present.
    try {
      const sequelizeBps = getSequelizeBps();
      if (sequelizeBps) {
        await sequelizeBps.authenticate();
        await sequelizeBps.query("DELETE FROM data_merged_cache WHERE source_id=?", { replacements: [id] });
        await sequelizeBps.query("DROP TABLE IF EXISTS indikator_178");
        await sequelizeBps.close();
      }
    } catch (e) {
      console.warn("[hardRemove] best-effort cleanup data_bps failed:", e?.message || String(e));
    }

    return res.json({ ok: true, deleted: { id } });
  } catch (err) {
    return res.status(500).json({ message: err.message || String(err) });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });

    const row = await DataSource.findByPk(id);
    if (!row) return res.status(404).json({ message: "Datasource not found" });

    const body = req.body || {};
    const patch = {
      updated_at: new Date(),
    };

    if (body.name !== undefined) patch.name = String(body.name || "").trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.aliases !== undefined) patch.aliases = body.aliases;
    if (body.type !== undefined) patch.type = String(body.type || "").trim();
    if (body.api_url !== undefined) {
      patch.api_url = await applyWebApiKeyPlaceholder(String(body.api_url || "").trim());
    }
    if (body.period_key !== undefined) patch.period_key = body.period_key;
    if (body.summary_trend !== undefined) patch.summary_trend = body.summary_trend;
    if (body.auto_period !== undefined) patch.auto_period = Boolean(body.auto_period);
    if (body.status !== undefined) patch.status = Boolean(body.status);
    if (body.visible !== undefined) patch.visible = Boolean(body.visible);
    if (body.display_order !== undefined) patch.display_order = Number(body.display_order) || 0;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.color !== undefined) patch.color = body.color;
    if (body.category !== undefined) patch.category = body.category;
    if (body.compare_to !== undefined) patch.compare_to = body.compare_to;

    if (patch.type && !["dynamic", "static", "interop", "exim", "pressrelease"].includes(patch.type)) {
      return res.status(400).json({ message: "type harus dynamic|static|interop|exim|pressrelease" });
    }
    if (patch.name !== undefined && !patch.name) return res.status(400).json({ message: "name wajib diisi" });
    // api_url wajib untuk semua type kecuali pressrelease
    const nextType = patch.type || row.type;
    if (patch.api_url !== undefined && !patch.api_url && nextType !== "pressrelease") {
      return res.status(400).json({ message: "api_url wajib diisi" });
    }

    await row.update(patch);
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });

    const row = await DataSource.findByPk(id);
    if (!row) return res.status(404).json({ message: "Datasource not found" });

    // Soft delete: hide from normal lists
    await row.update({
      visible: false,
      status: false,
      updated_at: new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

// POST /datasource/exim/seed
// Creates/updates EXIM datasources (one per HS-2 group) and saves merged cache for 2020..latest available year.
exports.seedExim = async (req, res) => {
  try {
    const startYear = req.body?.startYear !== undefined ? Number(req.body.startYear) : 2020;
    const endYear = req.body?.endYear !== undefined ? Number(req.body.endYear) : new Date().getFullYear();
    const visible = req.body?.visible !== undefined ? Boolean(req.body.visible) : true;

    const result = await seedEximDatasources({ startYear, endYear, visible });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// POST /datasource/exim/seed/job
// Starts an async seed job; returns immediately with jobId and current logs/progress.
exports.seedEximJobStart = async (req, res) => {
  try {
    const { startSeedJob } = require('../services/exim/eximSeedJob.service');

    const startYear = req.body?.startYear !== undefined ? Number(req.body.startYear) : 2020;
    const endYear = req.body?.endYear !== undefined ? Number(req.body.endYear) : new Date().getFullYear();
    const visible = req.body?.visible !== undefined ? Boolean(req.body.visible) : true;

    const excludeHsFrom = req.body?.excludeHsFrom !== undefined ? Number(req.body.excludeHsFrom) : null;
    const excludeHsTo = req.body?.excludeHsTo !== undefined ? Number(req.body.excludeHsTo) : null;
    const mode = req.body?.mode !== undefined ? String(req.body.mode) : 'master';

    const requestedBy = req.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : null;
    const result = await startSeedJob({
      startYear,
      endYear,
      visible,
      requestedBy,
      mode,
      excludeHsFrom,
      excludeHsTo,
    });

    // If already running, communicate clearly so UI can attach to existing job.
    if (result?.alreadyRunning) {
      return res.status(409).json({ ok: false, code: 'EXIM_SEED_ALREADY_RUNNING', ...result });
    }
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// GET /datasource/exim/seed/job/:jobId
exports.seedEximJobStatus = async (req, res) => {
  try {
    const { getJob } = require('../services/exim/eximSeedJob.service');
    const jobId = String(req.params.jobId || '');
    if (!jobId) return res.status(400).json({ ok: false, message: 'jobId wajib' });
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Job tidak ditemukan' });
    return res.json({ ok: true, job });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// GET /datasource/exim/seed/job-active
exports.seedEximJobActive = async (_req, res) => {
  try {
    const { getActiveJobSummary } = require('../services/exim/eximSeedJob.service');
    const job = getActiveJobSummary();
    return res.json({ ok: true, job });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// POST /datasource/:id/search-terms/reindex
// Admin-only: rebuilds term index (data_source_search_terms) for a single datasource
exports.reindexSearchTermsForSource = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Invalid id' });

    const dryRun = req.body?.dryRun !== undefined ? Boolean(req.body.dryRun) : false;
    const result = await rebuildTermsForSource(id, { dryRun });
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// POST /datasource/search-terms/reindex
// Admin-only: rebuilds term index for all visible datasources (best-effort)
exports.reindexSearchTermsForAll = async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== undefined ? Boolean(req.body.dryRun) : false;
    const onlyVisible = req.body?.onlyVisible !== undefined ? Boolean(req.body.onlyVisible) : true;
    const limit = req.body?.limit !== undefined ? Number(req.body.limit) : 200;

    const results = await rebuildTermsForAllSources({ onlyVisible, dryRun, limit });
    return res.json({ ok: true, results });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// POST /datasource/:id/search-metadata/reindex
// Admin-only: rebuilds metadata search index from existing caches (no upstream fetch)
exports.reindexSearchMetadataForSourceFromCache = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Invalid id' });

    const dryRun = req.body?.dryRun !== undefined ? Boolean(req.body.dryRun) : false;
    const preferMerged = req.body?.preferMerged !== undefined ? Boolean(req.body.preferMerged) : true;

    const result = await reindexSearchMetadataFromCacheForSource(id, { preferMerged, dryRun });
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};

// POST /datasource/search-metadata/reindex
// Admin-only: rebuilds metadata search index from existing caches for many sources (no upstream fetch)
exports.reindexSearchMetadataForAllFromCache = async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== undefined ? Boolean(req.body.dryRun) : false;
    const onlyVisible = req.body?.onlyVisible !== undefined ? Boolean(req.body.onlyVisible) : true;
    const preferMerged = req.body?.preferMerged !== undefined ? Boolean(req.body.preferMerged) : true;
    const limit = req.body?.limit !== undefined ? Number(req.body.limit) : 200;
    const offset = req.body?.offset !== undefined ? Number(req.body.offset) : 0;

    const result = await reindexSearchMetadataFromCacheForAll({ onlyVisible, limit, offset, preferMerged, dryRun });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};
