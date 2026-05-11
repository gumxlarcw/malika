'use strict';

const knowledgeSyncService = require('./knowledgeSync.service');
const logger = require('../../utils/logger').child({ service: 'KnowledgeSyncScheduler' });

let _dailyTimer = null;

/**
 * Compute the UTC ms delay until the next `HH:MM` (WIT = UTC+9) wall-clock.
 * If the target has passed today (in WIT), schedule for tomorrow.
 */
function getNextRunDelayMs({ hour, minute }) {
  const nowMs = Date.now();
  const witNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const witNext = new Date(witNow);
  witNext.setUTCHours(hour, minute, 0, 0);
  if (witNext.getTime() <= witNow.getTime()) {
    witNext.setUTCDate(witNext.getUTCDate() + 1);
  }
  const nextUtcMs = witNext.getTime() - 9 * 60 * 60 * 1000;
  return Math.max(0, nextUtcMs - nowMs);
}

function getNextRunAt({ hour, minute }) {
  const ms = getNextRunDelayMs({ hour, minute });
  return new Date(Date.now() + ms);
}

function stopKnowledgeSyncScheduler() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _dailyTimer = null;
  knowledgeSyncService._setNextRunAt(null);
}

async function startKnowledgeSyncScheduler() {
  stopKnowledgeSyncScheduler();

  const state = await knowledgeSyncService.getSchedulerState();
  if (!state.enabled) {
    logger.info('Scheduler disabled in app_settings; not arming timer');
    return false;
  }

  const [hourStr, minuteStr] = String(state.schedule).split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs({ hour, minute });
    const nextAt = getNextRunAt({ hour, minute });
    knowledgeSyncService._setNextRunAt(nextAt);
    logger.info({ nextAt: nextAt.toISOString(), delayMs }, 'Knowledge-sync scheduler armed');

    _dailyTimer = setTimeout(async () => {
      try {
        await knowledgeSyncService.runDailySyncTracked();
      } catch (e) {
        logger.warn({ err: e.message }, 'Tracked knowledge-sync run failed');
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();
  return true;
}

async function restartKnowledgeSyncScheduler() {
  stopKnowledgeSyncScheduler();
  return await startKnowledgeSyncScheduler();
}

module.exports = {
  startKnowledgeSyncScheduler,
  stopKnowledgeSyncScheduler,
  restartKnowledgeSyncScheduler,
};
