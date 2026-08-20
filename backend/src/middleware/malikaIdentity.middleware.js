/**
 * Malika Identity Middleware
 * ==========================
 * Derives the trusted anonymous uid for `/chat/*` (and the public chat-feedback
 * / flag endpoints) from a server-signed `x-malika-token`, closing the IDOR
 * where ownership was based on a forgeable bare `x-malika-uid` header.
 *
 * Design: docs/superpowers/specs/2026-05-29-chat-idor-auth-design.md (§b).
 *
 * Controlled by env flag MALIKA_IDENTITY_STRICT (read per-request so a rollout
 * toggle / test can flip it without re-requiring the module):
 *   - off (rollout window): a missing/invalid token falls back to the bare
 *     x-malika-uid (legacy) and marks req.malikaLegacy for telemetry. No breakage.
 *   - on (post-migration): a missing/invalid token → 401 identity_required.
 *
 * On a valid token it sets req.malikaUid = payload.sub. Downstream owner
 * derivation (getOwnerIdFromReq) reads req.malikaUid.
 *
 * NOTE: the bootstrap route POST /chat/identity must NOT sit behind this
 * middleware — it is what mints the token, so in strict mode it would 401 the
 * very call that would issue one. Mount this per-route AFTER /identity.
 */

const { verifyToken } = require('../services/chat/anonIdentity.service');

function isStrict() {
  const v = String(process.env.MALIKA_IDENTITY_STRICT || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

function malikaIdentityMiddleware(req, res, next) {
  const token = req.get('x-malika-token') || '';
  const payload = token ? verifyToken(token) : null;

  if (payload && payload.sub) {
    req.malikaUid = payload.sub;
    req.malikaTokenPayload = payload;
    return next();
  }

  // No valid token.
  if (isStrict()) {
    return res.status(401).json({ ok: false, error: 'identity_required' });
  }

  // Dual-mode: trust the bare uid (legacy), flagged for telemetry.
  const bareUid = String(req.get('x-malika-uid') || req.get('x-malika-user') || '').trim();
  if (bareUid) {
    req.malikaUid = bareUid;
    req.malikaLegacy = true;
  }
  return next();
}

module.exports = { malikaIdentityMiddleware, isStrict };
