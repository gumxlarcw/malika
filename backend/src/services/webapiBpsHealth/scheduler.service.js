'use strict';

const { runProbe } = require('./probe.service');
const logger = require('../../utils/logger').child({ service: 'WebapiBpsHealthScheduler' });

const INTERVAL_MS = 15 * 60 * 1000; // 15 menit

let timer = null;

async function tick() {
  try {
    const result = await runProbe({ trigger: 'scheduled' });
    if (result.skipped) {
      logger.warn({ reason: result.reason }, 'Scheduled probe skipped');
    } else if (result.overall !== 'UP') {
      logger.warn({ runId: result.runId, overall: result.overall, durationMs: result.durationMs }, 'Scheduled probe non-UP');
    } else {
      logger.info({ runId: result.runId, durationMs: result.durationMs }, 'Scheduled probe OK');
    }
  } catch (err) {
    // Defense: must never crash scheduler
    logger.error({ err: err.message }, 'Scheduled probe threw — scheduler continues');
  }
}

function startWebapiBpsHealthScheduler() {
  if (timer) {
    logger.warn('Scheduler already started — skipping duplicate init');
    return;
  }
  // IMPORTANT: defer first run by INTERVAL (do NOT run on startup) to prevent
  // probe storm during PM2 restart loops.
  timer = setInterval(tick, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, 'WebAPI BPS health scheduler started');
}

function stopWebapiBpsHealthScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startWebapiBpsHealthScheduler,
  stopWebapiBpsHealthScheduler,
  INTERVAL_MS,
};
