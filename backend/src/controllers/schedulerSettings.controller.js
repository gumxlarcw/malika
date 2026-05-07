const { getJson, setJson } = require('../services/settings/appSettings.service');

const { restartAutomationScheduler } = require('../services/automation/scheduler.service');
const { restartPublicationNotificationScheduler } = require('../services/publication/scheduler.service');
const { restartMergedCacheNotificationScheduler } = require('../services/notification/mergedCacheScheduler.service');
const { restartPressReleaseNotificationScheduler } = require('../services/pressrelease/scheduler.service');

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseTimeHHMM(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hour = safeNumber(m[1], NaN);
  const minute = safeNumber(m[2], NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeSchedule(input, defaults) {
  const mode = String(input?.mode || defaults.mode || 'daily');
  const intervalMinutes = input?.interval_minutes != null ? safeNumber(input.interval_minutes, null) : null;
  const time = input?.time != null ? parseTimeHHMM(input.time) : null;

  const out = {
    mode: mode === 'interval' ? 'interval' : 'daily',
    interval_minutes: intervalMinutes != null && Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : null,
    run_hour: time ? time.hour : (input?.run_hour != null ? safeNumber(input.run_hour, defaults.run_hour) : defaults.run_hour),
    run_minute: time ? time.minute : (input?.run_minute != null ? safeNumber(input.run_minute, defaults.run_minute) : defaults.run_minute),
  };

  // If user selects interval but interval is empty/invalid, keep mode but interval null.
  // Scheduler will fallback to daily when interval is null.
  return out;
}

exports.getSettings = async (req, res) => {
  try {
    const automation = await getJson('scheduler:automation');
    const publication = await getJson('scheduler:publication');
    const mergedcache = await getJson('scheduler:mergedcache');
    const pressrelease = await getJson('scheduler:pressrelease');

    // Runtime/effective scheduler info (what is actually active in memory)
    let automationActive = null;
    let publicationActive = null;
    let mergedcacheActive = null;
    let pressreleaseActive = null;
    try {
      const a = require('../services/automation/scheduler.service');
      automationActive = {
        state: a.getAutomationSchedulerState ? a.getAutomationSchedulerState() : null,
        effective: a.getEffectiveSchedule ? await a.getEffectiveSchedule() : null,
        enabled_env: String(process.env.AUTOMATION_ENABLED || '') === 'true',
      };
    } catch {
      automationActive = null;
    }
    try {
      const p = require('../services/publication/scheduler.service');
      publicationActive = {
        state: p.getPublicationSchedulerState ? p.getPublicationSchedulerState() : null,
        effective: p.getEffectiveSchedule ? await p.getEffectiveSchedule() : null,
        enabled_env: String(process.env.PUBLICATION_NOTIFICATIONS_ENABLED || '') === 'true',
      };
    } catch {
      publicationActive = null;
    }
    try {
      const m = require('../services/notification/mergedCacheScheduler.service');
      mergedcacheActive = {
        state: m.getMergedCacheSchedulerState ? m.getMergedCacheSchedulerState() : null,
        effective: m.getEffectiveSchedule ? await m.getEffectiveSchedule() : null,
        enabled_env: String(process.env.MERGED_CACHE_NOTIFICATIONS_ENABLED || '') === 'true',
      };
    } catch {
      mergedcacheActive = null;
    }

    try {
      const pr = require('../services/pressrelease/scheduler.service');
      pressreleaseActive = {
        state: pr.getPressReleaseSchedulerState ? pr.getPressReleaseSchedulerState() : null,
        effective: pr.getEffectiveSchedule ? await pr.getEffectiveSchedule() : null,
        enabled_env: String(process.env.PRESSRELEASE_NOTIFICATIONS_ENABLED || '') === 'true',
      };
    } catch {
      pressreleaseActive = null;
    }

    res.json({
      ok: true,
      settings: {
        automation: automation || null,
        publication: publication || null,
        mergedcache: mergedcache || null,
        pressrelease: pressrelease || null,
      },
      active: {
        automation: automationActive,
        publication: publicationActive,
        mergedcache: mergedcacheActive,
        pressrelease: pressreleaseActive,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const body = req.body || {};

    const results = {};

    if (body.automation != null) {
      const normalized = normalizeSchedule(body.automation, { mode: 'daily', run_hour: 8, run_minute: 0 });
      results.automation = await setJson('scheduler:automation', normalized);
    }

    if (body.publication != null) {
      const normalized = normalizeSchedule(body.publication, { mode: 'daily', run_hour: 8, run_minute: 5 });
      results.publication = await setJson('scheduler:publication', normalized);
    }

    if (body.mergedcache != null) {
      const normalized = normalizeSchedule(body.mergedcache, { mode: 'interval', run_hour: 8, run_minute: 10 });
      results.mergedcache = await setJson('scheduler:mergedcache', normalized);
    }

    if (body.pressrelease != null) {
      const normalized = normalizeSchedule(body.pressrelease, { mode: 'daily', run_hour: 8, run_minute: 15 });
      results.pressrelease = await setJson('scheduler:pressrelease', normalized);
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
};

exports.restartSchedulers = async (req, res) => {
  try {
    const rawTarget =
      (typeof req.query?.target === 'string' && req.query.target.trim() ? req.query.target.trim() : null) ||
      (typeof req.body?.target === 'string' && req.body.target.trim() ? req.body.target.trim() : null);

    const allowed = new Set(['automation', 'publication', 'mergedcache', 'pressrelease']);
    const targets = rawTarget
      ? rawTarget
          .split(',')
          .map((s) => String(s).trim().toLowerCase())
          .filter(Boolean)
      : ['automation', 'publication', 'mergedcache'];

    const invalid = targets.filter((t) => !allowed.has(t));
    if (invalid.length) {
      return res.status(400).json({
        ok: false,
        message: `Invalid target: ${invalid.join(', ')}. Allowed: automation, publication, mergedcache`,
      });
    }

    const restarted = {};
    if (targets.includes('automation')) restarted.automation = await restartAutomationScheduler();
    if (targets.includes('publication')) restarted.publication = await restartPublicationNotificationScheduler();
    if (targets.includes('mergedcache')) restarted.mergedcache = await restartMergedCacheNotificationScheduler();
    if (targets.includes('pressrelease')) restarted.pressrelease = await restartPressReleaseNotificationScheduler();

    res.json({ ok: true, restarted, targets });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
};
