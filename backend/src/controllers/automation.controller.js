const DataSource = require('../models/DataSource.model');
const AutomationConfig = require('../models/AutomationConfig.model');
const AutomationRunLog = require('../models/AutomationRunLog.model');
const EximPodFilter = require('../models/EximPodFilter.model');
const { runAutomationForSource } = require('../services/automation/automationRunner.service');
const { getPressReleaseKeywordTableName } = require('../services/replication/pressreleaseTableBps.service');

function parsePodsJson(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(String(text));
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function getDbBpsInfo(sequelizeBps) {
  if (!sequelizeBps) return null;
  const dbName = sequelizeBps?.config?.database;
  if (dbName) return { dbName };
  try {
    const [rows] = await sequelizeBps.query('SELECT DATABASE() AS dbName');
    const name = rows?.[0]?.dbName;
    return name ? { dbName: name } : null;
  } catch {
    return null;
  }
}

async function getIndicatorTableStatus(sequelizeBps, dbName, sourceId) {
  const tableName = `indikator_${Number(sourceId)}`;
  const existsSql = `
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_schema = ? AND table_name = ?
  `;
  const [existsRows] = await sequelizeBps.query(existsSql, { replacements: [dbName, tableName] });
  const exists = Number(existsRows?.[0]?.cnt || 0) > 0;
  if (!exists) {
    return { tableName, exists: false, rows: 0, last_update: null, last_pulled_at: null, error: null };
  }

  const [aggRows] = await sequelizeBps.query(
    `SELECT
      COUNT(*) AS row_count,
      DATE_FORMAT(MAX(last_update), '%Y-%m-%dT%H:%i:%s') AS last_update,
      DATE_FORMAT(MAX(updated_at), '%Y-%m-%dT%H:%i:%s') AS last_pulled_at
    FROM \`${tableName}\``
  );

  return {
    tableName,
    exists: true,
    rows: Number(aggRows?.[0]?.row_count || 0),
    last_update: aggRows?.[0]?.last_update || null,
    last_pulled_at: aggRows?.[0]?.last_pulled_at || null,
    error: null,
  };
}

function parsePressreleaseKeywordFromDatasource(ds) {
  const dsKeywordRaw = String(ds?.api_url || '').trim();
  const keyword = dsKeywordRaw.toLowerCase().startsWith('keyword:')
    ? dsKeywordRaw.slice('keyword:'.length).trim()
    : dsKeywordRaw;
  return keyword || null;
}

async function getPressreleaseTableStatus(sequelizeBps, dbName, ds) {
  const keyword = parsePressreleaseKeywordFromDatasource(ds);
  if (!keyword) {
    return {
      tableName: null,
      exists: false,
      rows: 0,
      last_update: null,
      last_pulled_at: null,
      error: 'Pressrelease datasource membutuhkan keyword pada api_url (format: keyword:<kw>)',
    };
  }

  let tableName;
  try {
    tableName = getPressReleaseKeywordTableName(keyword);
  } catch (e) {
    return { tableName: null, exists: false, rows: 0, last_update: null, last_pulled_at: null, error: e?.message || String(e) };
  }

  const existsSql = `
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_schema = ? AND table_name = ?
  `;
  const [existsRows] = await sequelizeBps.query(existsSql, { replacements: [dbName, tableName] });
  const exists = Number(existsRows?.[0]?.cnt || 0) > 0;
  if (!exists) {
    return { tableName, exists: false, rows: 0, last_update: null, last_pulled_at: null, error: null };
  }

  const [aggRows] = await sequelizeBps.query(
    `SELECT
      COUNT(*) AS row_count,
      DATE_FORMAT(MAX(last_update), '%Y-%m-%dT%H:%i:%s') AS last_update,
      DATE_FORMAT(MAX(updated_at), '%Y-%m-%dT%H:%i:%s') AS last_pulled_at
    FROM \`${tableName}\``
  );

  return {
    tableName,
    exists: true,
    rows: Number(aggRows?.[0]?.row_count || 0),
    last_update: aggRows?.[0]?.last_update || null,
    last_pulled_at: aggRows?.[0]?.last_pulled_at || null,
    error: null,
  };
}

async function listAutomationStatus(req, res) {
  const datasources = await DataSource.findAll({ order: [['display_order', 'ASC'], ['id', 'ASC']] });
  const configs = await AutomationConfig.findAll();
  const cfgBySource = new Map(configs.map((c) => [Number(c.source_id), c]));

  const podFilters = await EximPodFilter.findAll();
  const podFilterBySource = new Map(podFilters.map((p) => [Number(p.source_id), p]));

  // Best-effort: include production-table status from data_bps if configured
  let bps = null;
  let sequelizeBps = null;
  let bpsError = null;
  try {
    const getSequelizeBps = require('../config/db_bps');
    sequelizeBps = getSequelizeBps();
    if (sequelizeBps) {
      await sequelizeBps.authenticate();
      bps = await getDbBpsInfo(sequelizeBps);
    }
  } catch (e) {
    bpsError = e?.message || String(e);
    sequelizeBps = null;
    bps = null;
  }

  const items = [];
  for (const ds of datasources) {
    const sid = Number(ds.id);
    const cfg = cfgBySource.get(sid);

    let prod = { tableName: `indikator_${sid}`, exists: false, rows: 0, last_update: null, last_pulled_at: null, error: null };
    if (sequelizeBps && bps?.dbName) {
      try {
        if (String(ds.type || '') === 'pressrelease') {
          prod = await getPressreleaseTableStatus(sequelizeBps, bps.dbName, ds);
        } else {
          prod = await getIndicatorTableStatus(sequelizeBps, bps.dbName, sid);
        }
      } catch (e) {
        prod.error = e?.message || String(e);
      }
    }

    items.push({
      source: { id: sid, name: ds.name || null },
      datasource: { type: ds.type || 'dynamic' },
      production: prod,
      exim_pod_filter:
        String(ds.type || '') === 'exim'
          ? (() => {
              const pf = podFilterBySource.get(sid);
              if (!pf) return { enabled: false, pods_count: 0, updated_at: null };
              const pods = parsePodsJson(pf.pods_json);
              return {
                enabled: Boolean(pf.enabled) && pods.length > 0,
                pods_count: pods.length,
                updated_at: pf.updated_at || null,
              };
            })()
          : null,
      automation: cfg
        ? {
            enabled: Boolean(cfg.enabled),
            mode: cfg.mode || 'daily',
            last_run_at: cfg.last_run_at || null,
            last_success_at: cfg.last_success_at || null,
            last_pull_started_at: cfg.last_pull_started_at || null,
            last_pull_finished_at: cfg.last_pull_finished_at || null,
            last_bps_last_update: cfg.last_bps_last_update || null,
            last_signature: cfg.last_signature || null,
            last_error: cfg.last_error || null,
          }
        : {
            enabled: false,
            mode: 'daily',
            last_run_at: null,
            last_success_at: null,
            last_pull_started_at: null,
            last_pull_finished_at: null,
            last_bps_last_update: null,
            last_signature: null,
            last_error: null,
          },
    });
  }

  const { getAutomationSchedulerState } = require('../services/automation/scheduler.service');
  const sched = getAutomationSchedulerState();

  res.json({
    scheduler_enabled: Boolean(sched.enabled),
    scheduler_mode: sched.mode || null,
    scheduler_next_run_at: sched.nextRunAt
      ? new Date(sched.nextRunAt).toISOString()
      : null,
    poll_minutes: Number(process.env.AUTOMATION_POLL_MINUTES || 60),
    min_interval_hours: Number(process.env.AUTOMATION_MIN_INTERVAL_HOURS || 24),
    data_bps: {
      available: Boolean(sequelizeBps),
      connected: Boolean(sequelizeBps && bps?.dbName),
      dbName: bps?.dbName || null,
      error: bpsError,
    },
    items,
  });
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
  listAutomationStatus,
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
