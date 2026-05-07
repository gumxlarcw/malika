const crypto = require('crypto');
const DataSource = require('../../models/DataSource.model');
const { runAutomationForSource } = require('./automationRunner.service');

// In-memory job store (single-node PM2 is fine)
// Allows admin UI to poll progress and view logs.
const jobs = new Map();
const activeJobBySource = new Map(); // sourceId -> jobId

function nowIso() {
  // Force GMT+9 (Asia/Jayapura) regardless of server timezone.
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

function clampPercent(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function bumpPercent(job, next) {
  const current = Number(job.progress?.percent || 0);
  const target = clampPercent(next);
  job.progress.percent = Math.max(current, target);
}

function updateProgressFromLog(job, line) {
  const m = String(line || '');

  // Keep percent monotonic.
  if (m.includes('Config updated:')) bumpPercent(job, 5);

  if (m.includes('Smart mode: checking latest')) bumpPercent(job, 10);
  if (m.includes('Latest th_id detected:')) bumpPercent(job, 12);
  if (m.includes('Remote last_update')) bumpPercent(job, 15);
  if (m.includes('No newer update; skipping')) bumpPercent(job, 100);

  if (m.includes('Full refresh')) bumpPercent(job, 20);
  if (m.includes('Available periods count:')) bumpPercent(job, 70);
  if (m.includes('Saved primary:')) bumpPercent(job, 80);
  if (m.includes('Replicating to data_bps')) bumpPercent(job, 85);
  if (m.includes('Saved replica:')) bumpPercent(job, 90);
  if (m.includes('Upserted production table:')) bumpPercent(job, 95);
  if (m.includes('Automation config updated:')) bumpPercent(job, 98);
}

function summarizeJob(job) {
  return {
    jobId: job.id,
    source_id: job.sourceId,
    mode: job.mode,
    status: job.status,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    progress: job.progress,
    result: job.result,
    error: job.error,
    logs: job.logs,
  };
}

async function startAutomationRunJob({ sourceId, mode = 'daily', requestedBy = null }) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) throw new Error('Invalid sourceId');

  const existingJobId = activeJobBySource.get(sid);
  if (existingJobId) {
    const existing = jobs.get(existingJobId);
    if (existing && existing.status === 'running') {
      return { alreadyRunning: true, job: summarizeJob(existing) };
    }
    activeJobBySource.delete(sid);
  }

  const ds = await DataSource.findByPk(sid);
  if (!ds) {
    const err = new Error('DataSource not found');
    err.status = 404;
    throw err;
  }

  const id = createJobId();
  const job = {
    id,
    sourceId: sid,
    mode,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    requestedBy,
    progress: {
      percent: 1,
      message: 'Starting...',
    },
    logs: [],
    result: null,
    error: null,
  };

  jobs.set(id, job);
  activeJobBySource.set(sid, id);

  // Fire-and-forget execution; state updated in-memory.
  (async () => {
    const pushLog = (line) => {
      const s = String(line);
      job.logs.push(s);
      job.logs = capLogs(job.logs, 2000);

      updateProgressFromLog(job, s);
      job.progress.message = s;
    };

    try {
      pushLog(`[${nowIso()}] Automation job started id=${id} source_id=${sid} mode=${mode}`);
      const result = await runAutomationForSource({ sourceId: sid, mode, log: pushLog });
      job.result = result;
      bumpPercent(job, 100);
      // Default: treat runs as OK unless runner explicitly returns ok=false.
      // IMPORTANT: Boolean(undefined) is false, so never use Boolean(result.ok) here.
      const ok = result != null && result.ok !== false;
      job.status = ok ? 'done' : 'failed';
      job.error = ok ? null : (typeof result?.error === 'string' ? result.error : 'Automation finished with errors');
      job.finishedAt = nowIso();
      pushLog(`[${nowIso()}] Automation job finished ok=${ok}`);
    } catch (e) {
      job.status = 'failed';
      job.error = e?.message || String(e);
      job.finishedAt = nowIso();
      pushLog(`[${nowIso()}] Automation job finished ok=false error=${job.error}`);
    } finally {
      if (activeJobBySource.get(sid) === id) activeJobBySource.delete(sid);

      // Keep only last 20 jobs to avoid memory growth.
      const all = Array.from(jobs.values()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      const keep = new Set(all.slice(0, 20).map((j) => j.id));
      for (const key of jobs.keys()) {
        if (!keep.has(key)) jobs.delete(key);
      }
    }
  })();

  return { alreadyRunning: false, job: summarizeJob(job) };
}

function getAutomationRunJob(jobId) {
  const job = jobs.get(String(jobId));
  return job ? summarizeJob(job) : null;
}

module.exports = {
  startAutomationRunJob,
  getAutomationRunJob,
};
