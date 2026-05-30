'use strict';

/**
 * Anonymous identity gate for PWA chat (IDOR hardening, 2026-05-29).
 * Trusts the uid only when it arrives as a valid server-signed token.
 * The strict flag is read per-request so rollout can flip it without redeploy.
 */
const { verifyToken } = require('../services/chat/anonIdentity.service');

function isStrict() {
  return String(process.env.MALIKA_IDENTITY_STRICT || '').trim().toLowerCase() === 'true';
}

function malikaIdentityMiddleware(req, res, next) {
  const token = req.get('x-malika-token') || '';
  const payload = token ? verifyToken(token) : null;

  if (payload && payload.sub) {
    req.malikaUid = payload.sub;
    req.malikaTokenPayload = payload;
    return next();
  }

  if (isStrict()) {
    return res.status(401).json({ ok: false, error: 'identity_required' });
  }

  // Dual-mode rollout window: accept the bare uid, tag for telemetry.
  const legacy = String(req.get('x-malika-uid') || req.get('x-malika-user') || '').trim();
  if (legacy) {
    req.malikaUid = legacy;
    req.malikaLegacy = true;
  }
  return next();
}

module.exports = { malikaIdentityMiddleware };
