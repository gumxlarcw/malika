'use strict';
/**
 * Daily scheduler that resyncs stale indicator_meta rows into retrieval_chunks.
 * Fires at 06:30 WIT — 30 minutes after knowledge-sync (06:00 WIT) so the two
 * embed loads don't compete. WIT-aware timing matches knowledgeSyncScheduler.
 *
 * Schedule is currently fixed; if it needs to be configurable later, follow
 * the same app_settings pattern used by knowledgeSync.
 */
const { resyncStaleRows } = require('./indicatorMetaSync.service');
const logger = require('../../utils/logger').child({ service: 'IndicatorMetaScheduler' });

const RUN_HOUR_WIT = 6;
const RUN_MINUTE_WIT = 30;

let _dailyTimer = null;
let _running = false;

function getNextRunDelayMs() {
  const nowMs = Date.now();
  const witNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const witNext = new Date(witNow);
  witNext.setUTCHours(RUN_HOUR_WIT, RUN_MINUTE_WIT, 0, 0);
  if (witNext.getTime() <= witNow.getTime()) {
    witNext.setUTCDate(witNext.getUTCDate() + 1);
  }
  const nextUtcMs = witNext.getTime() - 9 * 60 * 60 * 1000;
  return Math.max(0, nextUtcMs - nowMs);
}

function stopIndicatorMetaScheduler() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _dailyTimer = null;
}

function startIndicatorMetaScheduler() {
  stopIndicatorMetaScheduler();

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs();
    const nextAt = new Date(Date.now() + delayMs);
    logger.info({ nextAt: nextAt.toISOString(), delayMs }, 'indicator-meta scheduler armed');

    _dailyTimer = setTimeout(async () => {
      if (_running) {
        logger.warn('previous resync still running; skipping this tick');
        scheduleNext();
        return;
      }
      _running = true;
      try {
        await resyncStaleRows();
      } catch (e) {
        logger.warn({ err: e.message }, 'indicator-meta resync failed');
      } finally {
        _running = false;
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();
  return true;
}

module.exports = {
  startIndicatorMetaScheduler,
  stopIndicatorMetaScheduler,
};
