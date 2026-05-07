const { checkMergedCacheUpdates } = require('./mergedCacheWatch.service');
const { getJson } = require('../settings/appSettings.service');

let timer = null;
let dailyTimer = null;
let running = false;
let currentState = {
  name: 'mergedcache',
  enabled: false,
  schedule: null,
  source: null,
  mode: null,
  intervalMs: null,
  runHour: null,
  runMinute: null,
  nextRunAt: null,
  lastTickAt: null,
  startedAt: null,
};

function getNextRunDelayMs({ hour, minute }) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

function getNextRunAt({ hour, minute }) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function getScheduleFromEnv() {
  const intervalMinutes = Number(process.env.MERGED_CACHE_NOTIFICATIONS_INTERVAL_MINUTES || 15);
  const runHour = Number(process.env.MERGED_CACHE_NOTIFICATIONS_RUN_HOUR || 8);
  const runMinute = Number(process.env.MERGED_CACHE_NOTIFICATIONS_RUN_MINUTE || 10);

  // Prefer interval if configured and valid.
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) return { mode: 'interval', intervalMinutes };
  return { mode: 'daily', runHour, runMinute };
}

async function getEffectiveSchedule() {
  const fromDb = await getJson('scheduler:mergedcache');
  if (fromDb && typeof fromDb === 'object') {
    const mode = String(fromDb.mode || '').toLowerCase() === 'daily' ? 'daily' : 'interval';
    const intervalMinutes = fromDb.interval_minutes != null ? Number(fromDb.interval_minutes) : null;
    const runHour = fromDb.run_hour != null ? Number(fromDb.run_hour) : 8;
    const runMinute = fromDb.run_minute != null ? Number(fromDb.run_minute) : 10;

    if (mode === 'interval' && intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
      return { mode: 'interval', intervalMinutes, source: 'db' };
    }

    return {
      mode: 'daily',
      runHour: Number.isFinite(runHour) ? runHour : 8,
      runMinute: Number.isFinite(runMinute) ? runMinute : 10,
      source: 'db',
    };
  }

  return { ...getScheduleFromEnv(), source: 'env' };
}

function getMergedCacheSchedulerState() {
  return { ...currentState };
}

async function startMergedCacheNotificationScheduler() {
  const enabled = String(process.env.MERGED_CACHE_NOTIFICATIONS_ENABLED || '') === 'true';
  if (!enabled) {
    console.log('[mergedcache] notification scheduler disabled (set MERGED_CACHE_NOTIFICATIONS_ENABLED=true to enable)');
    currentState = {
      ...currentState,
      enabled: false,
      schedule: null,
      source: null,
      mode: null,
      intervalMs: null,
      runHour: null,
      runMinute: null,
      nextRunAt: null,
      startedAt: null,
    };
    return null;
  }

  stopMergedCacheNotificationScheduler();

  const schedule = await getEffectiveSchedule();

  currentState = {
    ...currentState,
    enabled: true,
    startedAt: new Date(),
    schedule,
    source: schedule.source || null,
    mode: schedule.mode || null,
    intervalMs: null,
    runHour: schedule.runHour ?? null,
    runMinute: schedule.runMinute ?? null,
    nextRunAt: null,
  };

  const intervalMinutes = schedule.mode === 'interval' ? Number(schedule.intervalMinutes) : null;
  const max = Number(process.env.MERGED_CACHE_NOTIFICATIONS_MAX || 50);
  const signature = process.env.MERGED_CACHE_NOTIFICATIONS_SIGNATURE || null;

  const baseInfo = `max=${max}${signature ? ` signature=${signature}` : ''} source=${schedule.source}`;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkMergedCacheUpdates({
        max,
        signature,
        log: (m) => console.log(`[mergedcache] ${m}`),
      });
    } catch (e) {
      console.warn('[mergedcache] tick failed:', e?.message || String(e));
    } finally {
      running = false;
    }
  };

  // Warm start + first tick soon.
  setTimeout(() => {
    currentState.lastTickAt = new Date();
    tick();
  }, 2_000);

  if (schedule.mode === 'interval' && intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    const intervalMs = Math.max(30_000, Math.floor(intervalMinutes * 60_000));
    currentState.intervalMs = intervalMs;
    currentState.nextRunAt = new Date(Date.now() + intervalMs);
    console.log(`[mergedcache] notification scheduler enabled: every=${Math.round(intervalMs / 1000)}s ${baseInfo}`);
    timer = setInterval(() => {
      currentState.lastTickAt = new Date();
      currentState.nextRunAt = new Date(Date.now() + intervalMs);
      tick();
    }, intervalMs);
    return true;
  }

  const runHour = Number(schedule.runHour);
  const runMinute = Number(schedule.runMinute);
  currentState.runHour = runHour;
  currentState.runMinute = runMinute;

  console.log(
    `[mergedcache] notification scheduler enabled: daily_at=${String(runHour).padStart(2, '0')}:${String(runMinute).padStart(2, '0')} ${baseInfo}`
  );

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs({ hour: runHour, minute: runMinute });
    const nextAt = getNextRunAt({ hour: runHour, minute: runMinute });
    currentState.nextRunAt = nextAt;
    console.log(`[mergedcache] next run scheduled at ${nextAt.toISOString()} (local=${nextAt.toString()})`);
    dailyTimer = setTimeout(() => {
      currentState.lastTickAt = new Date();
      tick().finally(() => scheduleNext());
    }, delayMs);
  };

  scheduleNext();
  return true;
}

function stopMergedCacheNotificationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = null;
}

async function restartMergedCacheNotificationScheduler() {
  stopMergedCacheNotificationScheduler();
  return await startMergedCacheNotificationScheduler();
}

module.exports = {
  startMergedCacheNotificationScheduler,
  stopMergedCacheNotificationScheduler,
  restartMergedCacheNotificationScheduler,
  getEffectiveSchedule,
  getMergedCacheSchedulerState,
};
