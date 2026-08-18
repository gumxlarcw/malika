const {
  startAutomationStatusJob,
  getAutomationStatusJob,
} = require('../services/automation/automationStatusJob.service');

jest.setTimeout(20_000);

const REQUIRED_PATHS = [
  ['source', 'id'],
  ['source', 'name'],
  ['datasource', 'type'],
  ['production', 'tableName'],
  ['production', 'exists'],
  ['production', 'rows'],
  ['production', 'last_update'],
  ['production', 'last_pulled_at'],
  ['production', 'error'],
  ['automation', 'enabled'],
  ['automation', 'mode'],
  ['automation', 'last_run_at'],
  ['automation', 'last_success_at'],
  ['automation', 'last_pull_started_at'],
  ['automation', 'last_pull_finished_at'],
  ['automation', 'last_bps_last_update'],
  ['automation', 'last_signature'],
  ['automation', 'last_error'],
];

function hasPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(k in cur)) return false;
    cur = cur[k];
  }
  return true;
}

// These exercise the real database (they assert on live rows), so they cannot
// run where no DB is provisioned — CI included. Mirrors the SKIP_DB_TESTS
// convention already used by migrations.searchFulltext.test.js.
const runDb = process.env.SKIP_DB_TESTS !== '1';

(runDb ? describe : describe.skip)('automationStatusJob shape', () => {
  test('items[] retains every required field path', async () => {
    const { job: started } = await startAutomationStatusJob({});
    const jobId = started.jobId;

    let job = started;
    for (let i = 0; i < 60; i++) {
      job = getAutomationStatusJob(jobId);
      if (!job) throw new Error('Job vanished during polling');
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(job.status).toBe('done');
    expect(Array.isArray(job.data.items)).toBe(true);
    expect(job.data.items.length).toBeGreaterThan(0);

    const missing = [];
    for (const item of job.data.items) {
      for (const path of REQUIRED_PATHS) {
        if (!hasPath(item, path)) missing.push({ sid: item?.source?.id, path: path.join('.') });
      }
    }
    expect(missing).toEqual([]);
  });

  test('top-level fields include scheduler + data_bps + items', async () => {
    const { job: started } = await startAutomationStatusJob({});
    const jobId = started.jobId;

    let job = started;
    for (let i = 0; i < 60; i++) {
      job = getAutomationStatusJob(jobId);
      if (!job) throw new Error('Job vanished during polling');
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(job.status).toBe('done');
    const d = job.data;
    expect(typeof d.scheduler_enabled).toBe('boolean');
    expect('scheduler_mode' in d).toBe(true);
    expect('scheduler_next_run_at' in d).toBe(true);
    expect(typeof d.poll_minutes).toBe('number');
    expect(typeof d.min_interval_hours).toBe('number');
    expect(d.data_bps).toBeDefined();
    expect(typeof d.data_bps.available).toBe('boolean');
    expect(Array.isArray(d.items)).toBe(true);
  });
});
