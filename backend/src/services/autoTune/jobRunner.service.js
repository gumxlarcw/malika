'use strict';
const crypto = require('crypto');
const AutoTuneLog = require('../../models/AutoTuneLog.model');
const ChatMessageFlag = require('../../models/ChatMessageFlag.model');

const _jobs = new Map();

async function startAutoTuneJob({ flagId }) {
  if (!flagId) throw new Error('flagId required');
  const flag = await ChatMessageFlag.findByPk(flagId);
  if (!flag) {
    const err = new Error(`flag ${flagId} not found`);
    err.status = 404;
    throw err;
  }

  const jobId = crypto.randomBytes(8).toString('hex');
  _jobs.set(jobId, { status: 'queued', startedAt: Date.now(), flagId });
  const logRow = await AutoTuneLog.create({ job_id: jobId, flag_id: flagId, final_status: 'queued' });

  setImmediate(async () => {
    const job = _jobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    await logRow.update({ final_status: 'running' });

    try {
      const { runAgent } = require('./agent.service');
      const model = process.env.AUTO_TUNE_MODEL || 'claude-sonnet-4-6';
      const result = await runAgent({ jobId, flagId, model });
      const status = result.finalResult.kind === 'committed' ? 'committed'
                   : result.finalResult.kind === 'abandoned' ? 'abandoned'
                   : 'failed';
      job.status = status;
      job.result = result;

      await logRow.update({
        final_status: status,
        model_used: model,
        total_input_tokens: result.totalInput,
        total_output_tokens: result.totalOutput,
        proposed_changes: result.finalResult,
        regression_result: result.finalResult?.result?.regression || null,
        tool_call_log: result.toolLog || [],
        abandon_reason: result.finalResult?.reason || null,
        completed_at: new Date(),
        duration_ms: Date.now() - job.startedAt,
      });

      if (status === 'committed') {
        await ChatMessageFlag.update(
          { resolution_status: 'training_added', resolved_at: new Date() },
          { where: { id: flagId } }
        );
      }
    } catch (e) {
      console.error(`[AutoTune] job ${jobId} threw:`, e);
      job.status = 'failed';
      job.error = e.message;
      try {
        await logRow.update({
          final_status: 'failed',
          abandon_reason: e.message,
          completed_at: new Date(),
          duration_ms: Date.now() - job.startedAt,
        });
      } catch (_) { /* best-effort */ }
    }
  });

  return { jobId, status: 'queued' };
}

async function getJobStatus(jobId) {
  const job = _jobs.get(jobId);
  if (job) {
    return {
      jobId,
      flagId: job.flagId,
      status: job.status,
      startedAt: job.startedAt,
      durationMs: job.startedAt ? Date.now() - job.startedAt : 0,
      error: job.error || null,
    };
  }
  const row = await AutoTuneLog.findOne({ where: { job_id: jobId } });
  if (!row) return null;
  return {
    jobId,
    flagId: row.flag_id,
    status: row.final_status,
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
    abandonReason: row.abandon_reason,
    proposedChanges: row.proposed_changes,
    regressionResult: row.regression_result,
  };
}

module.exports = { startAutoTuneJob, getJobStatus };
