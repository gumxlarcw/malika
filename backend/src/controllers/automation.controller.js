const DataSource = require('../models/DataSource.model');
const AutomationConfig = require('../models/AutomationConfig.model');
const AutomationRunLog = require('../models/AutomationRunLog.model');
const EximPodFilter = require('../models/EximPodFilter.model');
const { runAutomationForSource } = require('../services/automation/automationRunner.service');

function parsePodsJson(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(String(text));
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function upsertAutomationConfig(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const enabled = Boolean(req.body?.enabled);
  const mode = String(req.body?.mode || 'daily');
  if (!['daily', 'smart'].includes(mode)) {
    return res.status(400).json({ message: 'mode must be daily|smart' });
  }

  const now = new Date();
  const [cfg] = await AutomationConfig.findOrCreate({
    where: { source_id: id },
    defaults: {
      enabled,
      mode,
      created_at: now,
      updated_at: now,
    },
  });

  await cfg.update({ enabled, mode, updated_at: now });
  res.json({ source_id: id, enabled: Boolean(cfg.enabled), mode: cfg.mode });
}

module.exports = {
  upsertAutomationConfig,
  runAutomationNow,
  runAutomationJobStart,
  getAutomationJobStatus,
  startAutomationStatusJob,
  getAutomationStatusJob,
  getLastAutomationLog,
  getEximPodFilter,
  upsertEximPodFilter,
  getEximPodOptions,
};

async function getEximPodFilter(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const ds = await DataSource.findByPk(id);
  if (!ds) return res.status(404).json({ message: 'DataSource not found' });
  if (String(ds.type || '') !== 'exim') return res.status(400).json({ message: 'POD filter hanya untuk EXIM' });

  const row = await EximPodFilter.findOne({ where: { source_id: id } });
  const pods = row ? parsePodsJson(row.pods_json) : [];
  return res.json({ ok: true, source_id: id, enabled: Boolean(row?.enabled) && pods.length > 0, pods, updated_at: row?.updated_at || null });
}

async function upsertEximPodFilter(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const ds = await DataSource.findByPk(id);
  if (!ds) return res.status(404).json({ message: 'DataSource not found' });
  if (String(ds.type || '') !== 'exim') return res.status(400).json({ message: 'POD filter hanya untuk EXIM' });

  const rawPods = Array.isArray(req.body?.pods) ? req.body.pods : [];
  const pods = Array.from(
    new Set(
      rawPods
        .map((x) => String(x).trim())
        .filter(Boolean)
    )
  ).slice(0, 500);

  const enabled = pods.length > 0;
  const now = new Date();

  const [row] = await EximPodFilter.findOrCreate({
    where: { source_id: id },
    defaults: {
      source_id: id,
      enabled,
      pods_json: JSON.stringify(pods),
      created_at: now,
      updated_at: now,
    },
  });

  await row.update({ enabled, pods_json: JSON.stringify(pods), updated_at: now });
  return res.json({ ok: true, source_id: id, enabled, pods, updated_at: row.updated_at || null });
}

async function getEximPodOptions(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const ds = await DataSource.findByPk(id);
  if (!ds) return res.status(404).json({ message: 'DataSource not found' });
  if (String(ds.type || '') !== 'exim') return res.status(400).json({ message: 'POD options hanya untuk EXIM' });

  let sequelizeBps = null;
  try {
    const getSequelizeBps = require('../config/db_bps');
    sequelizeBps = getSequelizeBps();
    if (!sequelizeBps) {
      return res.status(400).json({ ok: false, message: 'Koneksi data_bps tidak tersedia (cek DB_BPS_* env)' });
    }

    await sequelizeBps.authenticate();
    const [dbRows] = await sequelizeBps.query('SELECT DATABASE() AS dbName');
    const dbName = dbRows?.[0]?.dbName;
    if (!dbName) return res.status(500).json({ ok: false, message: 'Gagal membaca nama database data_bps' });

    const tableName = `indikator_${Number(id)}`;
    const [existsRows] = await sequelizeBps.query(
      'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema=? AND table_name=?',
      { replacements: [dbName, tableName] }
    );
    const exists = Number(existsRows?.[0]?.cnt || 0) > 0;
    if (!exists) return res.json({ ok: true, source_id: id, table: tableName, pods: [] });

    const [rows] = await sequelizeBps.query(
      `SELECT DISTINCT pod FROM \`${tableName}\` WHERE pod <> '' ORDER BY pod ASC LIMIT 2000`
    );
    const pods = Array.isArray(rows) ? rows.map((r) => String(r.pod || '').trim()).filter(Boolean) : [];
    return res.json({ ok: true, source_id: id, table: tableName, pods });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
}

async function startAutomationStatusJob(req, res) {
  try {
    const { startAutomationStatusJob } = require('../services/automation/automationStatusJob.service');
    const requestedBy = req.user?.email || req.user?.id || null;
    const result = await startAutomationStatusJob({ requestedBy });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || String(e) });
  }
}

async function getAutomationStatusJob(req, res) {
  const jobId = String(req.params.jobId || '');
  if (!jobId) return res.status(400).json({ ok: false, message: 'jobId wajib' });

  const { getAutomationStatusJob } = require('../services/automation/automationStatusJob.service');
  const job = getAutomationStatusJob(jobId);
  if (!job) return res.status(404).json({ ok: false, message: 'Job tidak ditemukan' });
  return res.json({ ok: true, job });
}

async function runAutomationJobStart(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const cfg = await AutomationConfig.findOne({ where: { source_id: id } });
  const mode = String(req.body?.mode || cfg?.mode || 'daily');
  if (!['daily', 'smart'].includes(mode)) {
    return res.status(400).json({ message: 'mode must be daily|smart' });
  }

  try {
    const { startAutomationRunJob } = require('../services/automation/automationRunJob.service');
    const requestedBy = req.user?.email || req.user?.id || null;
    const result = await startAutomationRunJob({ sourceId: id, mode, requestedBy });
    return res.json({ ok: true, ...result });
  } catch (e) {
    const status = Number(e?.status) || 500;
    return res.status(status).json({ ok: false, message: e?.message || String(e) });
  }
}

async function getAutomationJobStatus(req, res) {
  const jobId = String(req.params.jobId || '');
  if (!jobId) return res.status(400).json({ ok: false, message: 'jobId wajib' });

  const { getAutomationRunJob } = require('../services/automation/automationRunJob.service');
  const job = getAutomationRunJob(jobId);
  if (!job) return res.status(404).json({ ok: false, message: 'Job tidak ditemukan' });

  const toJayapuraPrefix = (line) => {
    const s = String(line || '');
    const m = s.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\]\s?(.*)$/);
    if (!m) return s;
    const dt = new Date(m[1]);
    if (!Number.isFinite(dt.getTime())) return s;
    const local = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
    const ts = local.toISOString().slice(0, 19) + '+09:00';
    return `[${ts}] ${m[2]}`;
  };

  const logs = Array.isArray(job.logs) ? job.logs.map(toJayapuraPrefix) : job.logs;
  return res.json({ ok: true, job: { ...job, logs } });
}

async function getLastAutomationLog(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const row = await AutomationRunLog.findOne({
    where: { source_id: id },
    order: [['created_at', 'DESC'], ['id', 'DESC']],
  });

  if (!row) {
    return res.status(404).json({ ok: false, message: 'Belum ada log untuk indikator ini' });
  }

  const logsText = row.logs ? String(row.logs) : '';
  const logs = logsText ? logsText.split('\n') : [];

  const toJayapuraPrefix = (line) => {
    const s = String(line || '');
    // Match: [2025-12-16T23:00:12.646Z] ...
    const m = s.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\]\s?(.*)$/);
    if (!m) return s;
    const dt = new Date(m[1]);
    if (!Number.isFinite(dt.getTime())) return s;
    const local = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
    const ts = local.toISOString().slice(0, 19) + '+09:00';
    return `[${ts}] ${m[2]}`;
  };

  const logsJayapura = logs.map(toJayapuraPrefix);

  res.json({
    ok: Boolean(row.ok),
    mode: row.mode || null,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    error: row.error || null,
    logs: logsJayapura,
  });
}

async function runAutomationNow(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid source_id' });

  const ds = await DataSource.findByPk(id);
  if (!ds) return res.status(404).json({ message: 'DataSource not found' });

  const cfg = await AutomationConfig.findOne({ where: { source_id: id } });
  const mode = String(req.body?.mode || cfg?.mode || 'daily');
  if (!['daily', 'smart'].includes(mode)) {
    return res.status(400).json({ message: 'mode must be daily|smart' });
  }

  const logs = [];
  const log = (line) => {
    logs.push(String(line));
  };

  const startedAt = new Date();
  log(`Run now: source_id=${id}, mode=${mode}`);

  try {
    const result = await runAutomationForSource({ sourceId: id, mode, log });
    const finishedAt = new Date();
    log(`Finished: duration_ms=${finishedAt.getTime() - startedAt.getTime()}`);
    res.json({
      ok: true,
      source: { id, name: ds.name || null },
      mode,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      result,
      logs,
    });
  } catch (e) {
    const finishedAt = new Date();
    log(`ERROR: ${e?.message || String(e)}`);
    const status = Number(e?.status) || 500;
    res.status(status).json({
      ok: false,
      source: { id, name: ds.name || null },
      mode,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      error: e?.message || String(e),
      logs,
    });
  }
}
