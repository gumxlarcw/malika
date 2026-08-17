'use strict';

/**
 * Dashboard controller.
 * Spec: docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md
 */

const svc = require('../services/dashboard/dashboard.service');

async function withGuard(req, res, fn) {
  try {
    const result = await fn();
    res.json({ ok: true, ...result });
  } catch (e) {
    const invalid = /Invalid/.test(e && e.message ? e.message : '');
    // Log server-side, return a generic message: responses must not leak internals.
    if (!invalid) console.error('[dashboard]', e);
    res.status(invalid ? 400 : 500).json({
      ok: false,
      error: invalid ? e.message : 'Server error',
    });
  }
}

async function getSummary(req, res) {
  return withGuard(req, res, () => svc.getSummary());
}

module.exports = { getSummary };
