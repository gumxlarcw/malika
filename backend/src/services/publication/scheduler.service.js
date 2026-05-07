const { pullPublications } = require('./pull.service');
const { getJson } = require('../settings/appSettings.service');

let running = false;
let intervalTimer = null;
let dailyTimer = null;
let currentState = {
  name: 'publication',
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

async function tickOnce() {
  if (running) return;
  running = true;
  try {
    await pullPublications({
      domainId: Number(process.env.PUBLICATION_DOMAIN_ID || 8200),
      forceRefresh: true,
      log: (m) => console.log(`[publication] ${m}`),
    });
  } catch (e) {
    console.warn('[publication] tick failed:', e?.message || String(e));
  } finally {
    running = false;
  }
}

function stopPublicationNotificationScheduler() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = null;
}

function getScheduleFromEnv() {
  const intervalMinutesRaw = process.env.PUBLICATION_INTERVAL_MINUTES;
  const intervalMinutes = intervalMinutesRaw != null && String(intervalMinutesRaw).trim() !== ''
    ? Number(intervalMinutesRaw)
    : null;

  if (intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return { mode: 'interval', intervalMinutes };
  }

  const runHour = Number(process.env.PUBLICATION_RUN_HOUR || 8);
  const runMinute = Number(process.env.PUBLICATION_RUN_MINUTE || 5);
  return { mode: 'daily', runHour, runMinute };
}

async function getEffectiveSchedule() {
  const fromDb = await getJson('scheduler:publication');
  if (fromDb && typeof fromDb === 'object') {
    const mode = String(fromDb.mode || '').toLowerCase() === 'interval' ? 'interval' : 'daily';
    const intervalMinutes = fromDb.interval_minutes != null ? Number(fromDb.interval_minutes) : null;
    const runHour = fromDb.run_hour != null ? Number(fromDb.run_hour) : 8;
    const runMinute = fromDb.run_minute != null ? Number(fromDb.run_minute) : 5;

    if (mode === 'interval' && intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
      return { mode: 'interval', intervalMinutes, source: 'db' };
    }

    return {
      mode: 'daily',
      runHour: Number.isFinite(runHour) ? runHour : 8,
      runMinute: Number.isFinite(runMinute) ? runMinute : 5,
      source: 'db',
    };
  }

  return { ...getScheduleFromEnv(), source: 'env' };
}

function getPublicationSchedulerState() {
  return { ...currentState };
}

async function startPublicationNotificationScheduler() {
  const enabled = String(process.env.PUBLICATION_NOTIFICATIONS_ENABLED || '') === 'true';
  if (!enabled) {
    console.log('[publication] notification scheduler disabled (set PUBLICATION_NOTIFICATIONS_ENABLED=true to enable)');
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

  stopPublicationNotificationScheduler();

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

  if (schedule.mode === 'interval') {
    const intervalMs = Math.max(60_000, Math.floor(Number(schedule.intervalMinutes) * 60_000));
    currentState.intervalMs = intervalMs;
    currentState.nextRunAt = new Date(Date.now() + intervalMs);
    console.log(`[publication] notification scheduler enabled: interval=${Math.round(intervalMs / 1000)}s (source=${schedule.source})`);

    setTimeout(() => {
      currentState.lastTickAt = new Date();
      currentState.nextRunAt = new Date(Date.now() + intervalMs);
      tickOnce();
    }, 2_000);
    intervalTimer = setInterval(() => {
      currentState.lastTickAt = new Date();
      currentState.nextRunAt = new Date(Date.now() + intervalMs);
      tickOnce();
    }, intervalMs);
    return true;
  }

  // Default: 08:05 local time
  const runHour = Number(schedule.runHour);
  const runMinute = Number(schedule.runMinute);
  currentState.runHour = runHour;
  currentState.runMinute = runMinute;

  console.log(
    `[publication] notification scheduler enabled: daily_at=${String(runHour).padStart(2, '0')}:${String(runMinute).padStart(2, '0')}`
  );

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs({ hour: runHour, minute: runMinute });
    const nextAt = getNextRunAt({ hour: runHour, minute: runMinute });
    currentState.nextRunAt = nextAt;
    console.log(`[publication] next run scheduled at ${nextAt.toISOString()} (local=${nextAt.toString()})`);
    dailyTimer = setTimeout(() => {
      currentState.lastTickAt = new Date();
      tickOnce().finally(() => scheduleNext());
    }, delayMs);
  };

  scheduleNext();
  return true;
}

async function restartPublicationNotificationScheduler() {
  stopPublicationNotificationScheduler();
  return await startPublicationNotificationScheduler();
}

module.exports = {
  startPublicationNotificationScheduler,
  stopPublicationNotificationScheduler,
  restartPublicationNotificationScheduler,
  getEffectiveSchedule,
  getPublicationSchedulerState,
};
