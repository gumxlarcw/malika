const AutomationConfig = require('../../models/AutomationConfig.model');
const { runAutomationForSource } = require('./automationRunner.service');
const { getJson } = require('../settings/appSettings.service');

let intervalTimer = null;
let dailyTimer = null;
let running = false;
let currentState = {
  name: 'automation',
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

function hoursSince(date) {
  if (!date) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(date).getTime();
  return ms / (1000 * 60 * 60);
}

async function tickOnce({ minIntervalHours }) {
  const enabled = await AutomationConfig.findAll({ where: { enabled: true } });
  for (const cfg of enabled) {
    // Daily scheduler: always attempt a run at the scheduled time.
    // (Lock conflicts are handled below; we don't want manual runs to block 18:00 runs.)
    const enforceMinInterval = false;
    if (enforceMinInterval) {
      const h = hoursSince(cfg.last_success_at || cfg.last_run_at);
      if (h < minIntervalHours) continue;
    }

    try {
      await runAutomationForSource({ sourceId: cfg.source_id, mode: cfg.mode || 'daily' });
    } catch (e) {
      if (e?.code === 'AUTOMATION_ALREADY_RUNNING' || Number(e?.status) === 409) {
        // Another run is already in progress for this source; do not mark as FAILED.
        continue;
      }
      await cfg.update({
        last_run_at: new Date(),
        last_error: e?.message || String(e),
        updated_at: new Date(),
      });
    }
  }
}

function getNextRunDelayMs({ hour, minute }) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(0, next.getTime() - now.getTime());
}

function getNextRunAt({ hour, minute }) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function stopAutomationScheduler() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = null;
}

function getScheduleFromEnv() {
  const intervalMinutesRaw = process.env.AUTOMATION_INTERVAL_MINUTES;
  const intervalMinutes = intervalMinutesRaw != null && String(intervalMinutesRaw).trim() !== ''
    ? Number(intervalMinutesRaw)
    : null;

  if (intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return { mode: 'interval', intervalMinutes };
  }

  const runHour = Number(process.env.AUTOMATION_RUN_HOUR || 8);
  const runMinute = Number(process.env.AUTOMATION_RUN_MINUTE || 0);
  return { mode: 'daily', runHour, runMinute };
}

async function getEffectiveSchedule() {
  const fromDb = await getJson('scheduler:automation');
  if (fromDb && typeof fromDb === 'object') {
    const mode = String(fromDb.mode || '').toLowerCase() === 'interval' ? 'interval' : 'daily';
    const intervalMinutes = fromDb.interval_minutes != null ? Number(fromDb.interval_minutes) : null;
    const runHour = fromDb.run_hour != null ? Number(fromDb.run_hour) : 8;
    const runMinute = fromDb.run_minute != null ? Number(fromDb.run_minute) : 0;

    if (mode === 'interval' && intervalMinutes && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
      return { mode: 'interval', intervalMinutes, source: 'db' };
    }

    return {
      mode: 'daily',
      runHour: Number.isFinite(runHour) ? runHour : 8,
      runMinute: Number.isFinite(runMinute) ? runMinute : 0,
      source: 'db',
    };
  }

  return { ...getScheduleFromEnv(), source: 'env' };
}

function getAutomationSchedulerState() {
  return { ...currentState };
}

async function startAutomationScheduler() {
  const enabled = String(process.env.AUTOMATION_ENABLED || '') === 'true';
  if (!enabled) {
    console.log('[automation] scheduler disabled (set AUTOMATION_ENABLED=true to enable)');
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

  stopAutomationScheduler();

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
    console.log(
      `[automation] scheduler enabled: interval=${Math.round(intervalMs / 1000)}s (source=${schedule.source})`
    );

    const tick = async () => {
      if (running) return;
      running = true;
      try {
        currentState.lastTickAt = new Date();
        currentState.nextRunAt = new Date(Date.now() + intervalMs);
        await tickOnce({ minIntervalHours: 0 });
      } catch (e) {
        console.warn('[automation] tick error:', e?.message || String(e));
      } finally {
        running = false;
      }
    };

    setTimeout(() => tick(), 2_000);
    intervalTimer = setInterval(() => tick(), intervalMs);
    return true;
  }

  const runHour = Number(schedule.runHour);
  const runMinute = Number(schedule.runMinute);
  currentState.runHour = runHour;
  currentState.runMinute = runMinute;

  // Legacy envs kept for compatibility in status output; scheduler no longer uses polling.
  const pollMinutes = Number(process.env.AUTOMATION_POLL_MINUTES || 60);
  const minIntervalHours = Number(process.env.AUTOMATION_MIN_INTERVAL_HOURS || 24);

  console.log(`[automation] scheduler enabled: daily_at=${String(runHour).padStart(2, '0')}:${String(runMinute).padStart(2, '0')}, minInterval=${minIntervalHours}h (poll=${pollMinutes}m legacy)`);

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs({ hour: runHour, minute: runMinute });
    const nextAt = getNextRunAt({ hour: runHour, minute: runMinute });
    currentState.nextRunAt = nextAt;
    console.log(`[automation] next run scheduled at ${nextAt.toISOString()} (local=${nextAt.toString()})`);
    dailyTimer = setTimeout(() => {
      currentState.lastTickAt = new Date();
      tickOnce({ minIntervalHours })
        .catch((e) => console.warn('[automation] tick error:', e?.message))
        .finally(() => scheduleNext());
    }, delayMs);
  };

  scheduleNext();
  return true;
}

async function restartAutomationScheduler() {
  stopAutomationScheduler();
  return await startAutomationScheduler();
}

module.exports = {
  startAutomationScheduler,
  stopAutomationScheduler,
  restartAutomationScheduler,
  getEffectiveSchedule,
  getAutomationSchedulerState,
};
