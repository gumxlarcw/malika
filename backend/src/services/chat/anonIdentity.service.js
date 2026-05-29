'use strict';

/**
 * Signed anonymous identity for PWA chat (IDOR hardening, 2026-05-29).
 * Wraps the existing localStorage UUID in an HS256 JWT the client cannot forge.
 * Uses a dedicated secret so an anon token can never satisfy admin authMiddleware
 * and vice-versa. Fails closed at load (mirrors utils/requireProxyUrl.js).
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.MALIKA_ANON_SECRET;
if (!SECRET || !String(SECRET).trim()) {
  throw new Error('[anonIdentity.service] MALIKA_ANON_SECRET env var must be set (fail-closed)');
}

const TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
const RENEW_SECONDS = 30 * 24 * 60 * 60; // renew when < 30 days remain

function issueToken(uid) {
  const sub = String(uid || '').trim();
  if (!sub) throw new Error('issueToken: uid required');
  return jwt.sign({ sub, typ: 'anon' }, SECRET, { expiresIn: TTL_SECONDS, algorithm: 'HS256' });
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    if (!payload || payload.typ !== 'anon' || !payload.sub) return null;
    return payload; // { sub, typ, iat, exp }
  } catch {
    return null;
  }
}

function shouldRenew(payload) {
  if (!payload || !payload.exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp - nowSec < RENEW_SECONDS;
}

module.exports = { issueToken, verifyToken, shouldRenew, TTL_SECONDS, RENEW_SECONDS };
