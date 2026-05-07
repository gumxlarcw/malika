const DataSource = require('../../models/DataSource.model');
const { pullPressRelease } = require('./pull.service');
const { getJson } = require('../settings/appSettings.service');

let running = false;
let intervalTimer = null;
let dailyTimer = null;
let currentState = {
  name: 'pressrelease',
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
  lastError: null,
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

function stopPressReleaseNotificationScheduler() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = null;
}

function parseKeywordFromApiUrl(apiUrl) {
  const raw = String(apiUrl || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith('keyword:')) return raw.slice('keyword:'.length).trim() || null;
  return raw;
}

function getScheduleFromEnv() {
  const intervalMinutesRaw = process.env.PRESSRELEASE_INTERVAL_MINUTES;
  const intervalMinutes = intervalMinutesRaw != null && String(intervalMinutesRaw).trim() !== '' ? Number(intervalMinutesRaw) : null;

  if (intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return { mode: 'interval', intervalMinutes };
  }

  const runHour = Number(process.env.PRESSRELEASE_RUN_HOUR || 8);
  const runMinute = Number(process.env.PRESSRELEASE_RUN_MINUTE || 15);
  return { mode: 'daily', runHour, runMinute };
}

async function getEffectiveSchedule() {
  const fromDb = await getJson('scheduler:pressrelease');
  if (fromDb && typeof fromDb === 'object') {
    const mode = String(fromDb.mode || '').toLowerCase() === 'interval' ? 'interval' : 'daily';
    const intervalMinutes = fromDb.interval_minutes != null ? Number(fromDb.interval_minutes) : null;
    const runHour = fromDb.run_hour != null ? Number(fromDb.run_hour) : 8;
    const runMinute = fromDb.run_minute != null ? Number(fromDb.run_minute) : 15;

    if (mode === 'interval' && intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
      return { mode: 'interval', intervalMinutes, source: 'db' };
    }

    return {
      mode: 'daily',
      runHour: Number.isFinite(runHour) ? runHour : 8,
      runMinute: Number.isFinite(runMinute) ? runMinute : 15,
      source: 'db',
    };
  }

  return { ...getScheduleFromEnv(), source: 'env' };
}

function getPressReleaseSchedulerState() {
  return { ...currentState };
}

async function tickOnce() {
  if (running) return;
  running = true;
  currentState.lastError = null;

  try {
    const maxSources = Math.max(1, Math.min(200, Number(process.env.PRESSRELEASE_SCHEDULER_MAX_SOURCES || 50)));

    const sources = await DataSource.findAll({
      where: { type: 'pressrelease', visible: true },
      order: [['display_order', 'ASC'], ['id', 'ASC']],
      limit: maxSources,
    });

    for (const ds of sources) {
      const keyword = parseKeywordFromApiUrl(ds.api_url);
      if (!keyword) continue;

      try {
        await pullPressRelease({
          sourceId: ds.id,
          keywordOverride: keyword,
          saveToBps: false,
          forceRefresh: true,
          log: (m) => console.log(`[pressrelease] source_id=${ds.id} ${m}`),
        });
      } catch (e) {
        console.warn(`[pressrelease] pull failed source_id=${ds.id}:`, e?.message || String(e));
      }
    }
  } catch (e) {
    currentState.lastError = e?.message || String(e);
    console.warn('[pressrelease] tick failed:', currentState.lastError);
  } finally {
    running = false;
  }
}

async function startPressReleaseNotificationScheduler() {
  const enabled = String(process.env.PRESSRELEASE_NOTIFICATIONS_ENABLED || '') === 'true';
  if (!enabled) {
    console.log('[pressrelease] notification scheduler disabled (set PRESSRELEASE_NOTIFICATIONS_ENABLED=true to enable)');
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

  stopPressReleaseNotificationScheduler();

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

  // Warm start + first tick soon.
  setTimeout(() => {
    currentState.lastTickAt = new Date();
    tickOnce();
  }, 2_000);

  if (schedule.mode === 'interval') {
    const intervalMs = Math.max(60_000, Math.floor(Number(schedule.intervalMinutes) * 60_000));
    currentState.intervalMs = intervalMs;
    currentState.nextRunAt = new Date(Date.now() + intervalMs);
    console.log(`[pressrelease] notification scheduler enabled: interval=${Math.round(intervalMs / 1000)}s (source=${schedule.source})`);

    intervalTimer = setInterval(() => {
      currentState.lastTickAt = new Date();
      currentState.nextRunAt = new Date(Date.now() + intervalMs);
      tickOnce();
    }, intervalMs);

    return true;
  }

  const runHour = Number(schedule.runHour);
  const runMinute = Number(schedule.runMinute);
  currentState.runHour = runHour;
  currentState.runMinute = runMinute;

  console.log(`[pressrelease] notification scheduler enabled: daily_at=${String(runHour).padStart(2, '0')}:${String(runMinute).padStart(2, '0')}`);

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs({ hour: runHour, minute: runMinute });
    const nextAt = getNextRunAt({ hour: runHour, minute: runMinute });
    currentState.nextRunAt = nextAt;
    console.log(`[pressrelease] next run scheduled at ${nextAt.toISOString()} (local=${nextAt.toString()})`);
    dailyTimer = setTimeout(() => {
      currentState.lastTickAt = new Date();
      tickOnce().finally(() => scheduleNext());
    }, delayMs);
  };

  scheduleNext();
  return true;
}

async function restartPressReleaseNotificationScheduler() {
  stopPressReleaseNotificationScheduler();
  return await startPressReleaseNotificationScheduler();
}

module.exports = {
  startPressReleaseNotificationScheduler,
  stopPressReleaseNotificationScheduler,
  restartPressReleaseNotificationScheduler,
  getEffectiveSchedule,
  getPressReleaseSchedulerState,
};
