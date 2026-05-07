const crypto = require('crypto');
const { seedEximDatasources, HS2_GROUPS, EXIM_VARIANTS } = require('./eximSeed.service');

// In-memory job store (sufficient for single-node deployment under PM2)
// Keeps last few jobs to allow admin to see results.
const jobs = new Map();
let activeJobId = null;

function nowIso() {
  return new Date().toISOString();
}

function createJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function capLogs(logs, maxLines) {
  if (!Array.isArray(logs)) return [];
  if (logs.length <= maxLines) return logs;
  return logs.slice(logs.length - maxLines);
}

function getActiveJob() {
  if (!activeJobId) return null;
  const job = jobs.get(activeJobId);
  if (!job) return null;
  if (job.status === 'running') return job;
  return null;
}

function summarizeJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    progress: job.progress,
    result: job.result,
    error: job.error,
    logs: job.logs,
  };
}

async function startSeedJob({
  startYear = 2020,
  endYear = new Date().getFullYear(),
  visible = true,
  requestedBy = null,
  mode = 'master',
  excludeHsFrom = null,
  excludeHsTo = null,
}) {
  const active = getActiveJob();
  if (active) {
    return { alreadyRunning: true, job: summarizeJob(active) };
  }

  const isExcluded = (code) => {
    if (excludeHsFrom == null || excludeHsTo == null) return false;
    const n = Number(code);
    const f = Number(excludeHsFrom);
    const t = Number(excludeHsTo);
    if (!Number.isFinite(n) || !Number.isFinite(f) || !Number.isFinite(t)) return false;
    return n >= f && n <= t;
  };

  const variantsCount = Array.isArray(EXIM_VARIANTS) && EXIM_VARIANTS.length ? EXIM_VARIANTS.length : 1;
  const totalToRun = HS2_GROUPS.filter((g) => !isExcluded(g.code)).length * variantsCount;

  const id = createJobId();
  const job = {
    id,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    requestedBy,
    params: { startYear, endYear, visible, mode, excludeHsFrom, excludeHsTo },
    progress: {
      total: totalToRun,
      done: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      current: null,
    },
    logs: [],
    result: null,
    error: null,
  };

  activeJobId = id;
  jobs.set(id, job);

  // Fire-and-forget work; job status and logs updated in-memory.
  (async () => {
    const pushLog = (line) => {
      job.logs.push(String(line));
      job.logs = capLogs(job.logs, 2000);

      // Update simple progress counters based on log lines (best-effort)
      const m = String(line);
      const matchStart = m.match(/HS\s(\d{2})(?:\s\(([^)]+)\))?:\sstart/);
      if (matchStart) job.progress.current = matchStart[1];
      const matchDone = m.match(/HS\s(\d{2})(?:\s\(([^)]+)\))?:\sdone/);
      if (matchDone) {
        job.progress.done = Math.min(job.progress.total, job.progress.done + 1);
        job.progress.current = null;
      }
    };

    try {
      pushLog(`[${nowIso()}] EXIM seed job started id=${id}`);
      const result = await seedEximDatasources({
        startYear,
        endYear,
        visible,
        mode,
        excludeHsFrom,
        excludeHsTo,
        log: pushLog,
      });

      job.result = result;
      job.progress.created = Array.isArray(result?.created) ? result.created.length : 0;
      job.progress.updated = Array.isArray(result?.updated) ? result.updated.length : 0;
      job.progress.skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      job.progress.errors = Array.isArray(result?.errors) ? result.errors.length : 0;
      job.progress.done = job.progress.total;
      const hasErrors = Array.isArray(result?.errors) && result.errors.length > 0;
      if (hasErrors) {
        job.status = 'failed';
        job.error = 'Seed finished with errors (check logs)';
        job.finishedAt = nowIso();
        pushLog(`[${nowIso()}] EXIM seed job finished ok=false error=${job.error}`);
      } else {
        job.status = 'done';
        job.finishedAt = nowIso();
        pushLog(`[${nowIso()}] EXIM seed job finished ok=true`);
      }
    } catch (e) {
      job.status = 'failed';
      job.error = e?.message || String(e);
      job.finishedAt = nowIso();
      pushLog(`[${nowIso()}] EXIM seed job finished ok=false error=${job.error}`);
    } finally {
      if (activeJobId === id) activeJobId = null;

      // Keep only last 5 jobs to avoid memory growth.
      const all = Array.from(jobs.values()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      const keep = new Set(all.slice(0, 5).map((j) => j.id));
      for (const key of jobs.keys()) {
        if (!keep.has(key)) jobs.delete(key);
      }
    }
  })();

  return { alreadyRunning: false, job: summarizeJob(job) };
}

function getJob(jobId) {
  const job = jobs.get(String(jobId));
  return job ? summarizeJob(job) : null;
}

function getActiveJobSummary() {
  const active = getActiveJob();
  return active ? summarizeJob(active) : null;
}

module.exports = {
  startSeedJob,
  getJob,
  getActiveJobSummary,
};
