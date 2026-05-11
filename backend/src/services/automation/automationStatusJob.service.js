const crypto = require('crypto');

const DataSource = require('../../models/DataSource.model');
const AutomationConfig = require('../../models/AutomationConfig.model');
const EximPodFilter = require('../../models/EximPodFilter.model');
const { getPressReleaseKeywordTableName } = require('../replication/pressreleaseTableBps.service');
const { getAutomationSchedulerState } = require('./scheduler.service');

// In-memory job store for building the automation status list progressively.
const jobs = new Map();
let activeJobId = null;

function nowIso() {
  // WIT (Asia/Jayapura) timestamp
  const local = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 19) + '+09:00';
}

function createJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function capLogs(logs, maxLines) {
  if (!Array.isArray(logs)) return [];
  if (logs.length <= maxLines) return logs;
  return logs.slice(logs.length - maxLines);
}

function parsePodsJson(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(String(text));
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function clampPercent(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
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
    return {
      tableName: null,
      exists: false,
      rows: 0,
      last_update: null,
      last_pulled_at: null,
      error: e?.message || String(e),
    };
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

function summarize(job) {
  return {
    jobId: job.id,
    status: job.status,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    progress: job.progress,
    data: job.data,
    error: job.error,
    logs: job.logs,
  };
}

function getActiveJob() {
  if (!activeJobId) return null;
  const job = jobs.get(activeJobId);
  if (!job) return null;
  if (job.status === 'running') return job;
  return null;
}

async function startAutomationStatusJob({ requestedBy = null } = {}) {
  const active = getActiveJob();
  if (active) return { alreadyRunning: true, job: summarize(active) };

  const id = createJobId();
  const job = {
    id,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    requestedBy,
    progress: {
      total: 0,
      loaded: 0,
      percent: 0,
      message: 'Starting...',
    },
    data: (() => {
      const sched = getAutomationSchedulerState();
      return {
        scheduler_enabled: Boolean(sched.enabled),
        scheduler_mode: sched.mode || null,
        scheduler_next_run_at: sched.nextRunAt
          ? new Date(sched.nextRunAt).toISOString()
          : null,
        poll_minutes: Number(process.env.AUTOMATION_POLL_MINUTES || 60),
        min_interval_hours: Number(process.env.AUTOMATION_MIN_INTERVAL_HOURS || 24),
        data_bps: { available: false, connected: false, dbName: null, error: null },
        items: [],
      };
    })(),
    logs: [],
    error: null,
  };

  activeJobId = id;
  jobs.set(id, job);

  (async () => {
    const pushLog = (m) => {
      job.logs.push(`[${nowIso()}] ${String(m)}`);
      job.logs = capLogs(job.logs, 500);
    };

    const updateProgress = () => {
      const total = Number(job.progress.total || 0);
      const loaded = Number(job.progress.loaded || 0);
      const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
      job.progress.percent = clampPercent(pct);
    };

    try {
      pushLog('Automation status job started');

      const datasources = await DataSource.findAll({ order: [['display_order', 'ASC'], ['id', 'ASC']] });
      const configs = await AutomationConfig.findAll();
      const cfgBySource = new Map(configs.map((c) => [Number(c.source_id), c]));

      // Persisted EXIM POD filter summary (best-effort, same DB as app).
      const podFilters = await EximPodFilter.findAll();
      const podFilterBySource = new Map(podFilters.map((p) => [Number(p.source_id), p]));

      job.progress.total = datasources.length;
      job.progress.loaded = 0;
      updateProgress();

      // Best-effort: include production-table status from data_bps if configured
      let bps = null;
      let sequelizeBps = null;
      let bpsError = null;
      try {
        const getSequelizeBps = require('../../config/db_bps');
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

      job.data.data_bps = {
        available: Boolean(sequelizeBps),
        connected: Boolean(sequelizeBps && bps?.dbName),
        dbName: bps?.dbName || null,
        error: bpsError,
      };

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

        job.data.items.push({
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

        job.progress.loaded += 1;
        job.progress.message = `Loaded ${job.progress.loaded}/${job.progress.total}`;
        updateProgress();
      }

      job.status = 'done';
      job.finishedAt = nowIso();
      job.progress.message = 'Done';
      updateProgress();
      pushLog('Automation status job finished ok=true');
    } catch (e) {
      job.status = 'failed';
      job.error = e?.message || String(e);
      job.finishedAt = nowIso();
      job.progress.message = 'Failed';
      updateProgress();
      pushLog(`Automation status job finished ok=false error=${job.error}`);
    } finally {
      if (activeJobId === id) activeJobId = null;

      // Keep last 5 jobs.
      const all = Array.from(jobs.values()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      const keep = new Set(all.slice(0, 5).map((j) => j.id));
      for (const key of jobs.keys()) {
        if (!keep.has(key)) jobs.delete(key);
      }
    }
  })();

  return { alreadyRunning: false, job: summarize(job) };
}

function getAutomationStatusJob(jobId) {
  const job = jobs.get(String(jobId));
  return job ? summarize(job) : null;
}

module.exports = {
  startAutomationStatusJob,
  getAutomationStatusJob,
};
