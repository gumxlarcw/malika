'use strict';
/**
 * Pattern retirement scheduler.
 *
 * Daily at 06:45 WIT, deactivates (NOT deletes) ChatErrorPattern rows that:
 *   - is_active = true
 *   - occurrence_count < 5
 *   - last_occurrence_at < NOW() - 90 DAY  OR  (last_occurrence_at IS NULL AND created_at < NOW() - 90 DAY)
 *
 * Deactivation preserves the row for audit; admin can re-activate if needed.
 *
 * Schedule slot: 06:45 WIT (15 min after indicator-meta at 06:30, 45 min after knowledge-sync at 06:00).
 */
const { Op } = require('sequelize');
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const logger = require('../../utils/logger').child({ service: 'PatternRetirement' });

const STALE_DAYS = 90;
const MIN_OCCURRENCE_TO_KEEP = 5;
const RUN_HOUR_WIT = 6;
const RUN_MINUTE_WIT = 45;

let _dailyTimer = null;
let _running = false;

async function retireStalePatterns() {
  const t0 = Date.now();
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const stale = await ChatErrorPattern.findAll({
    where: {
      is_active: true,
      occurrence_count: { [Op.lt]: MIN_OCCURRENCE_TO_KEEP },
      [Op.or]: [
        { last_occurrence_at: { [Op.lt]: staleCutoff } },
        { [Op.and]: [
          { last_occurrence_at: null },
          { created_at: { [Op.lt]: staleCutoff } },
        ]},
      ],
    },
  });

  const names = [];
  for (const p of stale) {
    await p.update({ is_active: false });
    names.push(p.pattern_name);
    logger.info({ id: p.id, name: p.pattern_name, occurrence_count: p.occurrence_count }, 'retired stale pattern');
  }

  const durationMs = Date.now() - t0;
  logger.info({ retired: names.length, durationMs }, 'pattern retirement pass complete');
  return { retired: names.length, names, durationMs };
}

function getNextRunDelayMs() {
  const nowMs = Date.now();
  const witNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const witNext = new Date(witNow);
  witNext.setUTCHours(RUN_HOUR_WIT, RUN_MINUTE_WIT, 0, 0);
  if (witNext.getTime() <= witNow.getTime()) {
    witNext.setUTCDate(witNext.getUTCDate() + 1);
  }
  return Math.max(0, witNext.getTime() - 9 * 60 * 60 * 1000 - nowMs);
}

function stopPatternRetirementScheduler() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _dailyTimer = null;
}

function startPatternRetirementScheduler() {
  stopPatternRetirementScheduler();
  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs();
    const nextAt = new Date(Date.now() + delayMs);
    logger.info({ nextAt: nextAt.toISOString(), delayMs }, 'pattern-retirement scheduler armed');
    _dailyTimer = setTimeout(async () => {
      if (_running) {
        logger.warn('previous retirement still running; skipping');
        scheduleNext();
        return;
      }
      _running = true;
      try {
        await retireStalePatterns();
      } catch (e) {
        logger.warn({ err: e.message }, 'pattern-retirement failed');
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
  retireStalePatterns,
  startPatternRetirementScheduler,
  stopPatternRetirementScheduler,
};
