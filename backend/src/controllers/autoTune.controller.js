const { startAutoTuneJob, getJobStatus } = require('../services/autoTune/jobRunner.service');

async function startJob(req, res) {
  try {
    const flagId = parseInt(req.params.id, 10);
    if (!flagId) return res.status(400).json({ ok: false, error: 'flag id required' });
    const result = await startAutoTuneJob({ flagId });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[AutoTune] startJob error:', error);
    return res.status(error.status || 500).json({ ok: false, error: error.message });
  }
}

async function status(req, res) {
  try {
    const result = await getJobStatus(req.params.jobId);
    if (!result) return res.status(404).json({ ok: false, error: 'job not found' });
    return res.json({ ok: true, job: result });
  } catch (error) {
    console.error('[AutoTune] status error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = { startJob, status };
